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
          result.push(withDocument(doc, BR));
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
        part = withDocument(owner, partial(SPAN, {"class": "part"}, part));
        part.currentText = text;
      }
      part.dirty = true;
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
        return yield(node.currentText, c);
      }
      else if (node.nodeName == "BR") {
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
    return {next: function(){return cc();}};
  }

  var nbspRegexp = new RegExp(nbsp, "g");

  // Search backwards through the top-level nodes until the next BR or
  // the start of the frame.
  function startOfLine(node) {
    while (node && node.nodeName != "BR")
      node = node.previousSibling;
    return node;
  };


  // The Editor object is the main inside-the-iframe interface.
  function Editor(options) {
    this.options = options;
    this.parent = parent;
    this.doc = document;
    this.container = this.doc.body;
    this.win = window;
    this.history = new History(this.container, this.options.undoDepth, this.options.undoDelay, this.parent);

    if (!window.Parser)
      throw "No parser loaded.";
    this.dirty = [];
    if (options.content) {
      this.importCode(options.content);
      this.history.initializing = true;
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
  }

  function isSafeKey(code) {
    return (code >= 16 && code <= 18) || // shift, control, alt
           (code >= 33 && code <= 40); // arrows, home, end
  }

  Editor.prototype = {
    // Split a chunk of code into lines, put them in the frame, and
    // schedule them to be coloured.
    importCode: function(code) {
      replaceChildNodes(this.container);
      var lines = splitSpaces(code.replace(nbspRegexp, " ")).replace(/\r\n?/g, "\n").split("\n");
      for (var i = 0; i != lines.length; i++) {
        if (i > 0)
          this.container.appendChild(withDocument(this.doc, BR));
        var line = lines[i];
        if (line.length > 0)
          this.container.appendChild(document.createTextNode(line));
      }
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

    // Intercept enter and tab, and assign their new functions.
    keyDown: function(event) {
      if (event.keyCode == 13) { // enter
        if (event.ctrlKey) {
          this.reparseBuffer();
        }
        else {
          select.insertNewlineAtCursor(this.win);
          this.indentAtCursor();
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
      var electric = Parser.electricChars;
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
          whiteSpace = withDocument(this.doc, partial(SPAN, {"class": "part whitespace"}, safeWhiteSpace(indent)));
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

    highlightAtCursor: function() {
      var cursor = select.selectionTopNode(this.container, false);
      if (cursor) {
        // Make sure the cursor will be recognized as dirty.
        if (cursor.nodeType != 3)
          cursor.dirty = true;
        // Store selection, highlight, restore selection.
        var sel = select.markSelection(this.win);
        this.highlight(cursor);
        select.selectMarked(sel);
      }
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
      if (!node) node = this.container.firstChild;
      if (!node) return;

      for (var i = 0; i < this.dirty.length; i++)
        if (this.dirty[i] == node) return;

      if (node.nodeType != 3)
        node.dirty = true;
      this.dirty.push(node);
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

    // The function that does the actual highlighting/colouring (with
    // help from the parser and the DOM normalizer). Its interface is
    // rather overcomplicated, because it is used in different
    // situations: ensuring that a certain line is highlighted, or
    // highlighting up to X lines starting from a certain point. The
    // 'from' argument gives the node at which it should start. If
    // this is null, it will start at the beginning of the frame. When
    // a number of lines is given with the 'lines' argument, it will
    // colour no more than that amount. If at any time it comes across
    // a 'clean' line (no dirty nodes), it will stop.
    highlight: function(from, lines){
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
        var part = withDocument(self.doc, partial(SPAN, {"class": "part " + token.style}, token.value));
        part.currentText = token.value;
        return part;
      }

      // Get the token stream. If from is null, we start with a new
      // parser from the start of the frame, otherwise a partial parse
      // is resumed.
      var parsed = from ? from.parserFromHere(multiStringStream(traverseDOM(from.nextSibling)))
        : Parser.make(multiStringStream(traverseDOM(container.firstChild)));

      // parts is a wrapper that makes it possible to 'delay' going to
      // the next DOM node until we are completely done with the one
      // before it. This is necessary because we are constantly poking
      // around in the DOM tree, and if the next node is fetched too
      // early it might get replaced before it is used.
      var parts = {
        current: null,
        forward: false,
        // Get the current part.
        get: function(){
          if (!this.current)
            this.current = from ? from.nextSibling : container.firstChild;
          else if (this.forward)
            this.current = this.current.nextSibling;
          this.forward = false;
          return this.current;
        },
        // Advance to the next part (do not fetch it yet).
        next: function(){
          if (this.forward)
            this.get();
          this.forward = true;
        },
        // Remove the current part from the DOM tree, and move to the
        // next.
        remove: function(){
          this.current = this.get().previousSibling;
          container.removeChild(this.current ? this.current.nextSibling : container.firstChild);
          this.forward = true;
        },
        // Advance to the next part that is not empty, discarding empty
        // parts.
        nextNonEmpty: function(){
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
        var part = parts.nextNonEmpty();

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
          if ((lines !== undefined && --lines <= 0) || (!lineDirty && lineHasNodes))
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
