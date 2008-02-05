/* The Editor object manages the content of the editable frame. It
 * catches events, colours nodes, and indents lines. This file also
 * holds some functions for transforming arbitrary DOM structures into
 * plain sequences of <span> and <br> elements
 */

var Editor = (function(){
  // The HTML elements whose content should be suffixed by a newline
  // when converting them to flat text.
  var newlineElements = {"P": true, "DIV": true, "LI": true};

  // Create a set of white-space characters that will not be collapsed
  // by the browser, but will not break text-wrapping either.
  function safeWhiteSpace(n) {
    var buffer = [], nb = true;
    for (; n > 0; n--) {
      buffer.push((nb || n == 1) ? nbsp : " ");
      nb = !nb;
    }
    return buffer.join("");
  }

  var multiWhiteSpace = new RegExp("[\\t " + nbsp + "]{2,}", "g");
  function splitSpaces(string) {
    return string.replace(multiWhiteSpace, function(s) {return safeWhiteSpace(s.length);});
  }

  // Helper function for traverseDOM. Flattens an arbitrary DOM node
  // into an array of textnodes and <br> tags.
  function simplifyDOM(root) {
    var doc = root.ownerDocument;
    var result = [];
    var leaving = false;

    function simplifyNode(node) {
      leaving = false;

      if (node.nodeType == 3) {
        node.nodeValue = splitSpaces(node.nodeValue.replace(/[\n\r]/g, ""));
        result.push(node);
      }
      else if (node.nodeName == "BR" && node.childNodes.length == 0) {
        result.push(node);
      }
      else {
        forEach(node.childNodes, simplifyNode);
        if (!leaving && newlineElements.hasOwnProperty(node.nodeName)) {
          leaving = true;
          result.push(doc.createElement("BR"));
        }
      }
    }

    simplifyNode(root);
    return result;
  }

  // Creates a MochiKit-style iterator that goes over a series of DOM
  // nodes. The values it yields are strings, the textual content of
  // the nodes. It makes sure that all nodes up to and including the
  // one whose text is being yielded have been 'normalized' to be just
  // <span> and <br> elements.
  // See the story.html file for some short remarks about the use of
  // continuation-passing style in this iterator.
  function traverseDOM(start){
    function yield(value, c){cc = c; return value;}
    function push(fun, arg, c){return function(){return fun(arg, c);};}
    function stop(){cc = stop; throw StopIteration;};
    var cc = push(scanNode, start, stop);
    var owner = start.ownerDocument;
    var nodeQueue = [];

    // Create a function that can be used to insert nodes after the
    // one given as argument.
    function pointAt(node){
      var parent = node.parentNode;
      var next = node.nextSibling;
      if (next)
        return function(newnode){parent.insertBefore(newnode, next);};
      else
        return function(newnode){parent.appendChild(newnode);};
    }
    var point = null;

    // Insert a normalized node at the current point. If it is a text
    // node, wrap it in a <span>, and give that span a currentText
    // property -- this is used to cache the nodeValue, because
    // directly accessing nodeValue is horribly slow on some browsers.
    // The dirty property is used by the highlighter to determine
    // which parts of the document have to be re-highlighted.
    function insertPart(part){
      var text = "\n";
      if (part.nodeType == 3) {
        text = part.nodeValue;
        var span = owner.createElement("SPAN");
        span.className = "part";
        span.appendChild(part);
        part = span;
        part.currentText = text;
      }
      part.dirty = true;
      nodeQueue.push(part);
      point(part);
      return text;
    }

    // Extract the text and newlines from a DOM node, insert them into
    // the document, and yield the textual content. Used to replace
    // non-normalized nodes.
    function writeNode(node, c){
      var toYield = [];
      forEach(simplifyDOM(node), function(part) {
        toYield.push(insertPart(part));
      });
      return yield(toYield.join(""), c);
    }

    // Check whether a node is a normalized <span> element.
    function partNode(node){
      if (node.nodeName == "SPAN" && node.childNodes.length == 1 && node.firstChild.nodeType == 3){
        node.currentText = node.firstChild.nodeValue;
        return true;
      }
      return false;
    }

    // Handle a node. Add its successor to the continuation if there
    // is one, find out whether the node is normalized. If it is,
    // yield its content, otherwise, normalize it (writeNode will take
    // care of yielding).
    function scanNode(node, c){
      if (node.nextSibling)
        c = push(scanNode, node.nextSibling, c);

      if (partNode(node)){
        nodeQueue.push(node);
        return yield(node.currentText, c);
      }
      else if (node.nodeName == "BR") {
        nodeQueue.push(node);
        return yield("\n", c);
      }
      else {
        point = pointAt(node);
        removeElement(node);
        return writeNode(node, c);
      }
    }

    // MochiKit iterators are objects with a next function that
    // returns the next value or throws StopIteration when there are
    // no more values.
    return {next: function(){return cc();}, nodes: nodeQueue};
  }

  var nbspRegexp = new RegExp(nbsp, "g");
  
  // Determine the text size of a processed node.
  function nodeSize(node) {
    if (node.nodeName == "BR")
      return 1;
    else
      return node.currentText.length;
  }

  // Search backwards through the top-level nodes until the next BR or
  // the start of the frame.
  function startOfLine(node) {
    while (node && node.nodeName != "BR")
      node = node.previousSibling;
    return node;
  };

  // Client interface for searching the content of the editor. Create
  // these by calling CodeMirror.getSearchCursor. To use, call
  // findNext on the resulting object -- this returns a boolean
  // indicating whether anything was found, and can be called again to
  // skip to the next find. Use the select and replace methods to
  // actually do something with the found locations.
  function SearchCursor(editor, string, fromCursor) {
    this.editor = editor; this.container = editor.container;
    this.string = string;
    // Are we currently at an occurrence of the search string?
    this.atOccurrence = false;
    // The object stores a set of nodes coming after its current
    // position, so that when the current point is taken out of the
    // DOM tree, we can still try to continue.
    this.fallbackSize = 15;
    var cursor;
    if (fromCursor && (cursor = select.cursorLine(this.container))) {
      // Adjust information returned by cursorline -- in here, BRs
      // count as a character, and null nodes mean 'end of document'.
      if (cursor.start)
        cursor.offset++;
      else
        cursor.start = this.container.firstChild;
      this.savePoint(cursor.start, cursor.offset);
    }
    else {
      this.savePoint(this.container.firstChild, 0);
    }
  }

  SearchCursor.prototype = {
    findNext: function() {
      // Can not search for empty string.
      if (!this.string) this.point = null;
      // End of buffer;
      if (!this.point || !this.container.firstChild) return false;
      // Make sure point is at a node that is still in the document.
      this.doFallback();

      // This chunk of variables and functions implement an interface
      // for going over the result of traverseDOM, with backtracking,
      // and the possibility to look up the current node and save its
      // position.
      var traverse = traverseDOM(this.point);
      var buffer = "", offset = this.offset + (this.atOccurrence ? 1 : 0);
      var total = offset;

      // Fetch the next character, or null if end of buffer.
      function nextChar() {
        while (offset >= buffer.length) {
          offset -= buffer.length;
          try {buffer = traverse.next();}
          catch (e) {
            if (e != StopIteration) throw e;
            return null;
          }
        }
        total++;
        return buffer.charAt(offset++);
      }
      // Re-scan the given string.
      function pushBack(piece) {
        total -= piece.length;
        buffer = piece + buffer.slice(offset);
        offset = 0;
      }
      // Save the current node. total is used to count the characters
      // consumed, which makes it possible to find back the relevant
      // node. Can not just take the last node, because backtracking
      // might have brought us back from there.
      function savePos(self) {
        for (var i = 0; true; i++) {
          var node = traverse.nodes[i];
          var size = nodeSize(node);
          if (total <= size) {
            self.savePoint(node, total);
            return;
          }
          total -= size;
        }
      }

      // Now search this stream for the needle string. While matching,
      // characters are pushed into the backtrack variable -- if the
      // match fails, we skip back to the second character of this
      // string.
      var search = this.string, backtrack = "", ch;
      while (ch = nextChar()) {
        if (ch == search.charAt(0)) {
          search = search.slice(1);
          backtrack += ch;
          if (!search) {
            pushBack(this.string);
            savePos(this);
            return (this.atOccurrence = true);
          }
        }
        else if (backtrack) {
          pushBack(backtrack.slice(1));
          backtrack = "";
          search = this.string;
        }
      }

      this.point = null;
      return (this.atOccurrence = false);
    },

    select: function() {
      // Can only select if we are at an occurrence and that occurrence
      // is still in the document.
      if (!this.atOccurrence || this.point.parentNode != this.container)
        return false;

      // Find the end of the match.
      var endNode = this.point, endOffset = this.offset + this.string.length;
      while (endNode && endOffset > nodeSize(endNode)) {
        endOffset -= nodeSize(endNode);
        endNode = endNode.nextSibling;
      }
      // If the end is not in the document, bail.
      if (!endNode)
        return false;

      this.editor.select({node: this.point, offset: this.offset},
                         {node: endNode, offset: endOffset});
      select.scrollToCursor(this.container);
      return true;
    },

    replace: function(string) {
      if (this.select())
        this.editor.replaceSelection(string);
    },

    // Save current point, and a bunch of nodes after that.
    savePoint: function(point, offset) {
      this.point = point;
      this.offset = offset;
      this.fallback = [];
      if (!point) return;
      for (var count = this.fallbackSize; count && point.nextSibling; count--) {
        point = point.nextSibling;
        this.fallback.push(point);
      }
    },

    // See if point is still valid. If not, try to restore position
    // using fallback nodes. If that also fails, jump back to start of
    // document.
    doFallback: function() {
      if (this.point.parentNode == this.container)
        return;
      this.offset = 0;
      for (var i = 0; i < this.fallbackSize; i++) {
        if (this.fallback[i].parentNode == this.container) {
          this.point = this.fallback[i];
          return;
        }
      }
      this.point = this.container.firstChild;
    }
  };

  // The Editor object is the main inside-the-iframe interface.
  function Editor(options) {
    this.options = options;
    this.parent = parent;
    this.doc = document;
    this.container = this.doc.body;
    this.win = window;
    this.history = new History(this.container, this.options.undoDepth, this.options.undoDelay, this.parent);

    if (!Editor.Parser)
      throw "No parser loaded.";
    if (options.parserConfig && Editor.Parser.configure)
      Editor.Parser.configure(options.parserConfig);

    if (!options.textWrapping)
      this.doc.body.style.whiteSpace = "pre";

    this.dirty = [];
    if (options.content)
      this.importCode(options.content);

    if (options.continuousScanning !== false) {
      this.scanner = this.documentScanner(options.linesPerPass);
      this.delayScanning();
    }

    // In IE, designMode frames can not run any scripts, so we use
    // contentEditable instead. Random ActiveX check is there because
    // Opera apparently also supports some kind of perverted form of
    // contentEditable.
    if (document.body.contentEditable != undefined && window.ActiveXObject)
      document.body.contentEditable = "true";
    else
      document.designMode = "on";

    addEventHandler(document, "keydown", method(this, "keyDown"));
    addEventHandler(document, "keypress", method(this, "keyPress"));
    addEventHandler(document, "keyup", method(this, "keyUp"));
    addEventHandler(document.body, "paste", method(this, "markCursorDirty"));
  }

  function isSafeKey(code) {
    return (code >= 16 && code <= 18) || // shift, control, alt
           (code >= 33 && code <= 40); // arrows, home, end
  }

  Editor.prototype = {
    // Split a chunk of code into lines, put them in the frame, and
    // schedule them to be coloured.
    importCode: function(code) {
      clearElement(this.container);
      this.insertLines(code, null);
      this.history.reset();
      if (this.container.firstChild){
        this.addDirtyNode(this.container.firstChild);
        this.scheduleHighlight();
      }
    },

    // Extract the code from the editor.
    getCode: function() {
      if (!this.container.firstChild)
        return "";

      var accum = [];
      forEach(traverseDOM(this.container.firstChild), method(accum, "push"));
      return accum.join("").replace(nbspRegexp, " ");
    },

    // Move the cursor to the start of a specific line (counting from 1).
    jumpToLine: function(line) {
      if (line <= 1 || !this.container.firstChild) {
        select.focusAfterNode(null, this.container);
      }
      else {
        var pos = this.container.firstChild;
        while (true) {
          if (pos.nodeName == "BR") line--;
          if (line <= 1 || !pos.nextSibling) break;
          pos = pos.nextSibling;
        }
        select.focusAfterNode(pos, this.container);
      }
      select.scrollToCursor(this.container);
    },

    // Find the line that the cursor is currently on.
    currentLine: function() {
      var line = 1, cursor = select.selectionPosition(this.container, true);
      if (!cursor) return;

      for (cursor = cursor.node; cursor; cursor = cursor.previousSibling) {
        if (cursor.nodeName == "BR")
          line++;
      }
      return line;
    },

    // Retrieve the selected text.
    selectedText: function() {
      this.highlightAtCursor();
      var start = select.selectionPosition(this.container, true);
      var end = select.selectionPosition(this.container, false);
      if (!start || !end) return "";

      var text = [];
      // First take the text from the start, if it is a text node.
      if (start.node && start.node.nodeName != "BR") {
        // Special case for selections that start and end in the same
        // node.
        if (start.node == end.node)
          return start.node.currentText.slice(start.offset, end.offset);
        else
          text.push(start.node.currentText.slice(start.offset));
      }
      // Go over node until we find the end node.
      if (end.node) {
        var pos = start.node ? start.node.nextSibling : this.container.firstChild;
        while (pos && pos != end.node) {
          text.push(pos.nodeName == "BR" ? "\n" : pos.currentText);
          pos = pos.nextSibling;
        }
      }
      // The last element. Since selectionPosition returns the node
      // before or around the cursor, a BR at the end should result in
      // a newline.
      if (end.node)
        text.push(end.node.nodeName == "BR" ? "\n" : end.node.currentText.slice(0, end.offset));
      return text.join("");
    },

    // Replace the selection with another piece of text.
    replaceSelection: function(text) {
      this.highlightAtCursor();
      var start = select.selectionPosition(this.container, true);
      var end = select.selectionPosition(this.container, false);
      if (!start || !end) return;

      // If the selection exists within a single text node, it has to
      // be split.
      if (start.node == end.node) {
        if (!start.node) {
          end.node = this.container.firstChild;
        }
        else if (start.node.nodeName == "BR") {
          end.node = start.node.nextSibling;
        }
        else {
          end.node = this.doc.createTextNode(end.node.currentText.slice(end.offset));
          insertAfter(end.node, start.node);
        }
        end.replaced = true;
      }

      // Cut off the parts of start.node and end.node that fall within
      // the selection (if applicable).
      if (start.node && start.node.nodeName != "BR") {
        start.node.currentText = start.node.currentText.slice(0, start.offset);
        clearElement(start.node);
        start.node.appendChild(this.doc.createTextNode(start.node.currentText));
      }
      if (end.node && !end.replaced && end.node.nodeName != "BR") {
        end.node.currentText = end.node.currentText.slice(end.offset);
        clearElement(end.node);
        end.node.appendChild(this.doc.createTextNode(end.node.currentText));
      }

      // Remove all nodes between them.
      var pos = start.node ? start.node.nextSibling : this.container.firstChild;
      while (pos && pos != end.node) {
        var temp = pos.nextSibling;
        removeElement(pos);
        pos = temp;
      }

      // Add the new lines, restore the cursor, mark changed area as
      // dirty.
      this.insertLines(text, start.node);
      this.select(start, end.node && {node: end.node, offset: 0});
      this.addDirtyNode(start.node);
      this.scheduleHighlight();
    },

    getSearchCursor: function(string, fromCursor) {
      return new SearchCursor(this, string, fromCursor);
    },

    // Select a piece of the document. Parameters are node/offset
    // objects, to is optional.
    select: function(from, to) {
      // select.focusNode only works on leaf nodes.
      function actualNode(node) {
        while (node && node.firstChild) node = node.firstChild;
        return node;
      }
      select.focusNode(this.container,
                       {node: actualNode(from.node), offset: from.offset},
                       to && {node: actualNode(to.node), offset: to.offset});
    },

    // Intercept enter and tab, and assign their new functions.
    keyDown: function(event) {
      // Don't scan when the user is typing.
      this.delayScanning();

      if (event.keyCode == 13) { // enter
        if (event.ctrlKey) {
          this.reparseBuffer();
        }
        else {
          select.insertNewlineAtCursor(this.win);
          this.indentAtCursor();
          select.scrollToCursor(this.container);
        }
        event.stop();
      }
      else if (event.keyCode == 9) { // tab
        this.handleTab();
        event.stop();
      }
      else if (event.ctrlKey && (event.keyCode == 90 || event.keyCode == 8)) { // ctrl-Z, ctrl-backspace
        this.undo();
        event.stop();
      }
      else if (event.ctrlKey && event.keyCode == 89) { // ctrl-Y
        this.redo();
        event.stop();
      }
    },

    // Check for characters that should re-indent the current line,
    // and prevent Opera from handling enter and tab anyway.
    keyPress: function(event) {
      var electric = Editor.Parser.electricChars;
      // Hack for Opera, and Firefox on OS X, in which stopping a
      // keydown event does not prevent the associated keypress event
      // from happening, so we have to cancel enter and tab again
      // here.
      if (event.code == 13 || event.code == 9)
        event.stop();
      else if (electric && electric.indexOf(event.character) != -1)
        this.parent.setTimeout(method(this, "indentAtCursor"), 0);
    },

    // Mark the node at the cursor dirty when a non-safe key is
    // released.
    keyUp: function(event) {
      if (!isSafeKey(event.keyCode))
        this.markCursorDirty();
    },

    // Indent the line following a given <br>, or null for the first
    // line. If given a <br> element, this must have been highlighted
    // so that it has an indentation method. Returns the whitespace
    // element that has been modified or created (if any).
    indentLineAfter: function(start) {
      // whiteSpace is the whitespace span at the start of the line,
      // or null if there is no such node.
      var whiteSpace = start ? start.nextSibling : this.container.firstChild;
      if (whiteSpace && !hasClass(whiteSpace, "whitespace"))
        whiteSpace = null;

      // Sometimes the start of the line can influence the correct
      // indentation, so we retrieve it.
      var firstText = whiteSpace ? whiteSpace.nextSibling : (start ? start.nextSibling : this.container.firstChild);
      var nextChars = (start && firstText && firstText.currentText) ? firstText.currentText : "";

      // Ask the lexical context for the correct indentation, and
      // compute how much this differs from the current indentation.
      var indent = start ? start.indentation(nextChars) : 0;
      var indentDiff = indent - (whiteSpace ? whiteSpace.currentText.length : 0);

      // If there is too much, this is just a matter of shrinking a span.
      if (indentDiff < 0) {
        if (indent == 0) {
          removeElement(whiteSpace);
          whiteSpace = null;
        }
        else {
          whiteSpace.currentText = safeWhiteSpace(indent);
          whiteSpace.firstChild.nodeValue = whiteSpace.currentText;
        }
      }
      // Not enough...
      else if (indentDiff > 0) {
        // If there is whitespace, we grow it.
        if (whiteSpace) {
          whiteSpace.currentText = safeWhiteSpace(indent);
          whiteSpace.firstChild.nodeValue = whiteSpace.currentText;
        }
        // Otherwise, we have to add a new whitespace node.
        else {
          whiteSpace = this.doc.createElement("SPAN");
          whiteSpace.className = "part whitespace";
          whiteSpace.appendChild(this.doc.createTextNode(safeWhiteSpace(indent)));
          if (start)
            insertAfter(whiteSpace, start);
          else
            insertAtStart(whiteSpace, this.containter);
        }
      }
      return whiteSpace;
    },

    undo: function() {
      this.highlightAtCursor();
      forEach(this.history.undo(), method(this, "addDirtyNode"));
      this.scheduleHighlight();
    },

    redo: function() {
      this.highlightAtCursor();
      forEach(this.history.redo(), method(this, "addDirtyNode"));
      this.scheduleHighlight();
    },

    // Re-highlight the selected part of the document.
    highlightAtCursor: function() {
      var pos = select.selectionTopNode(this.container, true);
      var to = select.selectionTopNode(this.container, false);
      if (pos === false || !to) return;

      var toIsText = to.nodeType == 3;
      if (!toIsText)
        to.dirty = true;

      var sel = select.markSelection(this.win);
      while (to.parentNode == this.container && (toIsText || to.dirty)) {
        var result = this.highlight(pos, 1, true);
        if (result) pos = result.node;
        else break;
      }
      select.selectMarked(sel);
    },

    // When tab is pressed with text selected, the whole selection is
    // re-indented, when nothing is selected, the line with the cursor
    // is re-indented.
    handleTab: function() {
      var start = select.selectionTopNode(this.container, true),
          end = select.selectionTopNode(this.container, false);
      if (start === false || end === false) return;

      if (start == end)
        this.indentAtCursor();
      else
        this.indentSelection(start, end);
    },

    // Adjust the amount of whitespace at the start of the line that
    // the cursor is on so that it is indented properly.
    indentAtCursor: function() {
      if (!this.container.firstChild) return;
      // The line has to have up-to-date lexical information, so we
      // highlight it first.
      this.highlightAtCursor();
      var cursor = select.selectionTopNode(this.container, false);
      // If we couldn't determine the place of the cursor,
      // there's nothing to indent.
      if (cursor === false)
        return;
      var lineStart = startOfLine(cursor);
      var whiteSpace = this.indentLineAfter(lineStart);
      if (cursor == lineStart && whiteSpace)
          cursor = whiteSpace;
      // This means the indentation has probably messed up the cursor.
      if (cursor == whiteSpace)
        select.focusAfterNode(cursor, this.container);
    },

    // Indent all lines whose start falls inside of the current
    // selection.
    indentSelection: function(current, end) {
      var sel = select.markSelection(this.win);
      if (!current)
        this.indentLineAfter(current);
      else
        current = startOfLine(current.previousSibling);

      while (current != end) {
        var result = this.highlight(current, 1);
        var next = result ? result.node : null;

        while (current != next && current != end)
          current = current ? current.nextSibling : this.container.firstChild;
        if (current != end)
          if (next) this.indentLineAfter(next);
      }
      select.selectMarked(sel);
    },

    // Find the node that the cursor is in, mark it as dirty, and make
    // sure a highlight pass is scheduled.
    markCursorDirty: function() {
      var cursor = select.selectionTopNode(this.container, false);
      if (cursor !== false && this.container.firstChild) {
        this.scheduleHighlight();
        this.addDirtyNode(cursor || this.container.firstChild);
      }
    },

    reparseBuffer: function() {
      forEach(this.container.childNodes, function(node) {node.dirty = true;});
      if (this.container.firstChild)
        this.addDirtyNode(this.container.firstChild);
    },

    // Add a node to the set of dirty nodes, if it isn't already in
    // there.
    addDirtyNode: function(node) {
      node = node || this.container.firstChild;
      if (!node) return;

      for (var i = 0; i < this.dirty.length; i++)
        if (this.dirty[i] == node) return;

      if (node.nodeType != 3)
        node.dirty = true;
      this.dirty.push(node);
    },

    // Insert the code from string after the given node (null for
    // start of document).
    insertLines: function(string, after) {
      var container = this.container;
      var next = after ? after.nextSibling : this.container.firstChild;
      var insert = next ?
        function(node) {container.insertBefore(node, next);}
      : function(node) {container.appendChild(node);};

      var lines = splitSpaces(string.replace(nbspRegexp, " ")).replace(/\r\n?/g, "\n").split("\n");
      for (var i = 0; i != lines.length; i++) {
        var line = lines[i];
        if (i > 0)
          insert(this.doc.createElement("BR"));
        if (line.length > 0)
          insert(this.doc.createTextNode(line));
      }
    },

    // Cause a highlight pass to happen in options.passDelay
    // milliseconds. Clear the existing timeout, if one exists. This
    // way, the passes do not happen while the user is typing, and
    // should as unobtrusive as possible.
    scheduleHighlight: function() {
      // Timeouts are routed through the parent window, because on
      // some browsers designMode windows do not fire timeouts.
      this.parent.clearTimeout(this.highlightTimeout);
      this.highlightTimeout = this.parent.setTimeout(method(this, "highlightDirty"), this.options.passDelay);
    },

    // Fetch one dirty node, and remove it from the dirty set.
    getDirtyNode: function() {
      while (this.dirty.length > 0) {
        var found = this.dirty.pop();
        // If the node has been coloured in the meantime, or is no
        // longer in the document, it should not be returned.
        if ((found.dirty || found.nodeType == 3) && found.parentNode)
          return found;
      }
      return null;
    },

    // Pick dirty nodes, and highlight them, until
    // options.linesPerPass lines have been highlighted. The highlight
    // method will continue to next lines as long as it finds dirty
    // nodes. It returns an object indicating the amount of lines
    // left, and information about the place where it stopped. If
    // there are dirty nodes left after this function has spent all
    // its lines, it shedules another highlight to finish the job.
    highlightDirty: function() {
      var lines = this.options.linesPerPass;
      var sel = select.markSelection(this.win);
      var start;
      while (lines > 0 && (start = this.getDirtyNode())){
        var result = this.highlight(start, lines);
        if (result) {
          lines = result.left;
          if (result.node && result.dirty)
            this.addDirtyNode(result.node);
        }
      }
      select.selectMarked(sel);
      if (start)
        this.scheduleHighlight();
    },

    // Creates a function that, when called through a timeout, will
    // continuously re-parse the document.
    documentScanner: function(linesPer) {
      var self = this, pos = null;
      return function() {
        // If the current node is no longer in the document... oh
        // well, we start over.
        if (pos && pos.parentNode != self.container)
          pos = null;
        var sel = select.markSelection(self.win);
        var result = self.highlight(pos, linesPer, true);
        select.selectMarked(sel);
        pos = result.node;
        self.delayScanning();
      }
    },

    // Starts the continuous scanning process for this document after
    // a given interval.
    delayScanning: function() {
      if (this.scanner) {
        this.parent.clearTimeout(this.documentScan);
        this.documentScan = this.parent.setTimeout(this.scanner, this.options.continuousScanning);
      }
    },

    // The function that does the actual highlighting/colouring (with
    // help from the parser and the DOM normalizer). Its interface is
    // rather overcomplicated, because it is used in different
    // situations: ensuring that a certain line is highlighted, or
    // highlighting up to X lines starting from a certain point. The
    // 'from' argument gives the node at which it should start. If
    // this is null, it will start at the beginning of the frame. When
    // a number of lines is given with the 'lines' argument, it will
    // colour no more than that amount. If at any time it comes across
    // a 'clean' line (no dirty nodes), it will stop, except when
    // 'cleanLines' is true.
    highlight: function(from, lines, cleanLines){
      var container = this.container, self = this;

      if (!container.firstChild)
        return;
      // Backtrack to the first node before from that has a partial
      // parse stored.
      while (from && !from.parserFromHere)
        from = from.previousSibling;
      // If we are at the end of the document, do nothing.
      if (from && !from.nextSibling)
        return;

      // Check whether a part (<span> node) and the corresponding token
      // match.
      function correctPart(token, part){
        return !part.reduced && part.currentText == token.value && hasClass(part, token.style);
      }
      // Shorten the text associated with a part by chopping off
      // characters from the front. Note that only the currentText
      // property gets changed. For efficiency reasons, we leave the
      // nodeValue alone -- we set the reduced flag to indicate that
      // this part must be replaced.
      function shortenPart(part, minus){
        part.currentText = part.currentText.substring(minus);
        part.reduced = true;
      }
      // Create a part corresponding to a given token.
      function tokenPart(token){
        var part = self.doc.createElement("SPAN");
        part.className = "part " + token.style;
        part.appendChild(self.doc.createTextNode(token.value));
        part.currentText = token.value;
        return part;
      }

      // Get the token stream. If from is null, we start with a new
      // parser from the start of the frame, otherwise a partial parse
      // is resumed.
      var traversal = traverseDOM(from ? from.nextSibling : container.firstChild),
          stream = multiStringStream(traversal),
          parsed = from ? from.parserFromHere(stream) : Editor.Parser.make(stream);

      // parts is an interface to make it possible to 'delay' fetching
      // the next DOM node until we are completely done with the one
      // before it. This is necessary because often the next node is
      // not yet available when we want to proceed past the current
      // one.
      var parts = {
        current: null,
        // Fetch current node.
        get: function(){
          if (!this.current)
            this.current = traversal.nodes.shift();
          return this.current;
        },
        // Advance to the next part (do not fetch it yet).
        next: function(){
          this.current = null;
        },
        // Remove the current part from the DOM tree, and move to the
        // next.
        remove: function(){
          container.removeChild(this.get());
          this.current = null;
        },
        // Advance to the next part that is not empty, discarding empty
        // parts.
        getNonEmpty: function(){
          var part = this.get();
          while (part.nodeName == "SPAN" && part.currentText == ""){
            var old = part;
            this.remove();
            part = this.get();
            // Adjust selection information, if any. See select.js for
            // details.
            select.replaceSelection(old.firstChild, part.firstChild || part, 0, 0);
          }
          return part;
        }
      };

      var lineDirty = false, lineHasNodes = false;;
      this.history.touch(from);

      // This forEach loops over the tokens from the parsed stream, and
      // at the same time uses the parts object to proceed through the
      // corresponding DOM nodes.
      forEach(parsed, function(token){
        var part = parts.getNonEmpty();

        if (token.value == "\n"){
          // The idea of the two streams actually staying synchronized
          // is such a long shot that we explicitly check.
          if (part.nodeName != "BR")
            throw "Parser out of sync. Expected BR.";

          if (part.dirty || !part.indentation)
            lineDirty = true;
          self.history.touch(part);

          // Every <br> gets a copy of the parser state and a lexical
          // context assigned to it. The first is used to be able to
          // later resume parsing from this point, the second is used
          // for indentation.
          part.parserFromHere = parsed.copy();
          part.indentation = token.indentation;
          part.dirty = false;
          // A clean line means we are done. Throwing a StopIteration is
          // the way to break out of a MochiKit forEach loop.
          if ((lines !== undefined && --lines <= 0) || (!lineDirty && lineHasNodes && !cleanLines))
            throw StopIteration;
          lineDirty = false; lineHasNodes = false;
          parts.next();
        }
        else {
          if (part.nodeName != "SPAN")
            throw "Parser out of sync. Expected SPAN.";
          if (part.dirty)
            lineDirty = true;
          lineHasNodes = true;

          // If the part matches the token, we can leave it alone.
          if (correctPart(token, part)){
            part.dirty = false;
            parts.next();
          }
          // Otherwise, we have to fix it.
          else {
            lineDirty = true;
            // Insert the correct part.
            var newPart = tokenPart(token);
            container.insertBefore(newPart, part);
            var tokensize = token.value.length;
            var offset = 0;
            // Eat up parts until the text for this token has been
            // removed, adjusting the stored selection info (see
            // select.js) in the process.
            while (tokensize > 0) {
              part = parts.get();
              var partsize = part.currentText.length;
              select.replaceSelection(part.firstChild, newPart.firstChild, tokensize, offset);
              if (partsize > tokensize){
                shortenPart(part, tokensize);
                tokensize = 0;
              }
              else {
                tokensize -= partsize;
                offset += partsize;
                parts.remove();
              }
            }
          }
        }
      });

      // The function returns some status information that is used by
      // hightlightDirty to determine whether and where it has to
      // continue.
      return {left: lines,
              node: parts.get(),
              dirty: lineDirty};
    }
  };

  return Editor;
})();

addEventHandler(window, "load", function() {
  var CodeMirror = window.frameElement.CodeMirror;
  CodeMirror.editor = new Editor(CodeMirror.options);
});
