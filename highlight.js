var JSEOptions = window.JSEOptions || {};
setdefault(JSEOptions,
           {newlineElements: setObject("P", "DIV", "LI"),
            safeKeys: setObject("KEY_ARROW_UP", "KEY_ARROW_DOWN", "KEY_ARROW_LEFT", "KEY_ARROW_RIGHT", "KEY_END", "KEY_HOME",
                                "KEY_PAGE_UP", "KEY_PAGE_DOWN", "KEY_SHIFT", "KEY_CTRL", "KEY_ALT", "KEY_SELECT"),
            stylesheet: "highlight.css",
            indentOnClosingBrace: true,
            parser: parseJavaScript});

var JSEditor = function(){
  function simplifyDOM(root) {
    var doc = root.ownerDocument;
    var current = root;
    var result = [];
    var leaving = false;

    function simplifyNode(node) {
      leaving = false;

      if (node.nodeType == 3) {
        node.nodeValue = node.nodeValue.replace(/[\n\r]/g, "").replace(/[\t ]/g, nbsp);
        result.push(node);
      }
      else if (node.nodeName == "BR" && node.childNodes.length == 0) {
        result.push(node);
      }
      else {
        forEach(node.childNodes, simplifyNode);
        if (!leaving && JSEOptions.newlineElements.hasOwnProperty(node.nodeName)) {
          leaving = true;
          result.push(withDocument(doc, BR));
        }
      }
    }

    simplifyNode(root);
    return result;
  }

  function traverseDOM(start){
    function yield(value, c){cc = c; return value;}
    function push(fun, arg, c){return function(){return fun(arg, c);};}
    function stop(){cc = stop; throw StopIteration;};
    var cc = push(scanNode, start, stop);
    var owner = start.ownerDocument;

    function pointAt(node){
      var parent = node.parentNode;
      var next = node.nextSibling;
      if (next)
        return function(newnode){parent.insertBefore(newnode, next);};
      else
        return function(newnode){parent.appendChild(newnode);};
    }
    var point = null;

    function insertPart(part){
      var text = "\n";
      if (part.nodeType == 3) {
        var text = part.nodeValue;
        part = withDocument(owner, partial(SPAN, {"class": "part"}, part));
        part.currentText = text;
      }
      part.dirty = true;
      point(part);
      return text;
    }

    function writeNode(node, c){
      var toYield = [];
      forEach(simplifyDOM(node), function(part) {
        toYield.push(insertPart(part));
      });
      return yield(toYield.join(""), c);
    }

    function partNode(node){
      if (node.nodeName == "SPAN" && node.childNodes.length == 1 && node.firstChild.nodeType == 3){
        node.currentText = node.firstChild.nodeValue;
        return true;
      }
      return false;
    }

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

    return {next: function(){return cc();}};
  }

  var nbspRegexp = new RegExp(nbsp, "g");

  function indentation(lexical, closing){
    if (lexical.type == "vardef")
      return lexical.indented + 4;
    if (lexical.type == "stat")
      return lexical.indented + 2;
    else if (lexical.align)
      return lexical.column - (closing ? 1 : 0);
    else
      return lexical.indented + (closing ? 0 : 2);
  }
  
  function JSEditor(place, width, height, content, options) {
    this.options = options || {}
    setdefault(this.options, JSEOptions);
  
    this.frame = createDOM("IFRAME", {"style": "border: 0; width: " + (width || 400) + "px; height: " + (height || 200) + "px; display: block;"});
    place(this.frame);
    this.win = this.frame.contentWindow;
    this.doc = this.win.document;
    this.doc.designMode = "on";
    this.doc.open();
    this.doc.write("<html><head><link rel=\"stylesheet\" type=\"text/css\" href=\"" + this.options.stylesheet + "\"/></head>" +
                   "<body class=\"editbox\" spellcheck=\"false\"></body></html>");
    this.doc.close();
  
    this.dirty = [];
  
    if (this.doc.body)
      this.init(content);
    else
      connect(this.frame, "onload", bind(function(){disconnectAll(this.frame, "onload"); this.init(content);}, this));
  }

  JSEditor.prototype = {
    linesPerShot: 10,
    shotDelay: 300,

    init: function (code) {
      this.container = this.doc.body;
      if (code)
        this.importCode(code);
      connect(this.doc, "onkeydown", method(this, "keyDown"));
      connect(this.doc, "onkeyup", method(this, "keyUp"));
    },

    importCode: function(code) {
      replaceChildNodes(this.container);
      var lines = code.replace(/[ \t]/g, nbsp).replace(/\r\n?/g, "\n").split("\n");
      for (var i = 0; i != lines.length; i++) {
        if (i > 0)
          this.container.appendChild(withDocument(this.doc, BR));
        var line = lines[i];
        if (line.length > 0)
          this.container.appendChild(this.doc.createTextNode(line));
      }
      if (this.container.firstChild){
        this.addDirtyNode(this.container.firstChild);
        this.scheduleHighlight();
      }
    },

    getCode: function() {
      if (!this.container.firstChild)
        return "";

      var accum = [];
      forEach(traverseDOM(this.container.firstChild), method(accum, "push"));
      return accum.join("").replace(nbspRegexp, " ");
    },

    keyDown: function(event) {
      var name = event.key().string;
      if (name == "KEY_ENTER") {
        insertNewlineAtCursor(this.win);
        this.indentAtCursor();
        event.stop();
      }
      else if (name == "KEY_TAB" || ((name == "KEY_SPACEBAR" || name == "KEY_I") && event.modifier().ctrl)) {
        this.indentAtCursor();
        event.stop();
      }
    },

    keyUp: function(event) {
      var name = event.key().string;
      if (this.options.indentOnClosingBrace && name == "KEY_RIGHT_SQUARE_BRACKET")
        this.indentAtCursor();
      else if (!this.options.safeKeys.hasOwnProperty(name))
        this.markCursorDirty();
    },

    highlightAtCursor: function(cursor) {
      if (cursor.valid) {
        var node = cursor.start || this.container.firstChild;
        if (node) {
          if (node.nodeType != 3)
            node.dirty = true;
          var sel = markSelection(this.win);
          this.highlight(node, true);
          selectMarked(sel);
          cursor = new Cursor(this.container);
        }
      }
      return cursor;
    },

    indentAtCursor: function() {
      var cursor = new Cursor(this.container)
      cursor = this.highlightAtCursor(cursor);
      if (!cursor.valid)
        return;

      var start = cursor.startOfLine();
      var whiteSpace = start ? start.nextSibling : this.container.lastChild;
      if (whiteSpace && !hasClass(whiteSpace, "whitespace"))
        whiteSpace = null;

      var firstText = whiteSpace ? whiteSpace.nextSibling : start ? start.nextSibling : this.container.firstChild;
      var closing = start && firstText && firstText.currentText && firstText.currentText.charAt(0) == start.lexicalContext.type;
      var indent = start ? indentation(start.lexicalContext, closing) : 0;
      var indentDiff = indent - (whiteSpace ? whiteSpace.currentText.length : 0);

      if (indentDiff < 0) {
        whiteSpace.currentText = repeatString(nbsp, indent);
        whiteSpace.firstChild.nodeValue = whiteSpace.currentText;
      }
      else if (indentDiff > 0) {
        if (whiteSpace) {
          whiteSpace.currentText += repeatString(nbsp, indentDiff);
          whiteSpace.firstChild.nodeValue = whiteSpace.currentText;
        }
        else {
          whiteSpace = withDocument(this.doc, function(){return SPAN({"class": "part whitespace"}, repeatString(nbsp, indentDiff))});
          if (start)
            insertAfter(whiteSpace, start);
          else
            insertAtStart(whiteSpace, this.containter);
        }
        if (cursor.start == start)
          cursor.start = whiteSpace;
      }
      if (cursor.start == whiteSpace)
        cursor.focus();
    },

    highlight: highlight,

    markCursorDirty: function() {
      var cursor = new Cursor(this.container);
      if (cursor.valid) {
        var node = cursor.start || this.container.firstChild;
        if (node) {
          this.scheduleHighlight();
          this.addDirtyNode(node);
        }
      }
    },

    addDirtyNode: function(node) {
      if (!member(this.dirty, node)){
        if (node.nodeType != 3)
          node.dirty = true;
        this.dirty.push(node);
      }
    },

    scheduleHighlight: function() {
      clearTimeout(this.highlightTimeout);
      this.highlightTimeout = setTimeout(bind(this.highlightDirty, this, this.linesPerShot), this.shotDelay);
    },

    getDirtyNode: function() {
      while (this.dirty.length > 0) {
        var found = this.dirty.pop();
        if ((found.dirty || found.nodeType == 3) && found.parentNode)
          return found;
      }
      return null;
    },

    highlightDirty: function(lines) {
      var sel = markSelection(this.win);
      var start;
      while (lines > 0 && (start = this.getDirtyNode())){
        var result = this.highlight(start, true, lines);
        if (result) {
          lines = result.left;
          if (result.node && result.dirty)
            this.addDirtyNode(result.node);
        }
      }
      selectMarked(sel);
      if (start)
        this.scheduleHighlight();
    }
  }

  function highlight(from, onlyDirtyLines, lines){
    var container = this.container;
    var document = this.doc;

    if (!container.firstChild)
      return;
    while (from && !from.parserFromHere)
      from = from.previousSibling;
    if (from && !from.nextSibling)
      return;

    function correctPart(token, part){
      return !part.reduced && part.currentText == token.value && hasClass(part, token.style);
    }
    function shortenPart(part, minus){
      part.currentText = part.currentText.substring(minus);
      part.reduced = true;
    }
    function tokenPart(token){
      var part = withDocument(document, partial(SPAN, {"class": "part " + token.style}, token.value));
      part.currentText = token.value;
      return part;
    }

    var parsed = from ? from.parserFromHere(multiStringStream(traverseDOM(from.nextSibling)))
      : this.options.parser(multiStringStream(traverseDOM(container.firstChild)));

    var parts = {
      current: null,
      forward: false,
      get: function(){
        if (!this.current)
          this.current = from ? from.nextSibling : container.firstChild;
        else if (this.forward)
          this.current = this.current.nextSibling;
        this.forward = false;
        return this.current;
      },
      next: function(){
        if (this.forward)
          this.get();
        this.forward = true;
      },
      remove: function(){
        this.current = this.get().previousSibling;
        container.removeChild(this.current ? this.current.nextSibling : container.firstChild);
        this.forward = true;
      },
      nextNonEmpty: function(){
        var part = this.get();
        while (part.nodeName == "SPAN" && part.currentText == ""){
          var old = part;
          this.remove();
          part = this.get();
          replaceSelection(old.firstChild, part.firstChild || part, 0, 0);
        }
        return part;
      }
    };

    var lineDirty = false;

    forEach(parsed, function(token){
      var part = parts.nextNonEmpty();
      if (token.type == "newline"){
        if (part.nodeName != "BR")
          throw "Parser out of sync. Expected BR.";
        if (part.dirty || !part.lexicalContext)
          lineDirty = true;
        part.parserFromHere = parsed.copy();
        part.lexicalContext = token.lexicalContext;
        part.dirty = false;
        if ((lines !== undefined && --lines <= 0) ||
            (onlyDirtyLines && !lineDirty))
          throw StopIteration;
        lineDirty = false;
        parts.next();
      }
      else {
        if (part.nodeName != "SPAN")
          throw "Parser out of sync. Expected SPAN.";
        if (part.dirty)
          lineDirty = true;

        if (correctPart(token, part)){
          part.dirty = false;
          parts.next();
        }
        else {
          lineDirty = true;
          var newPart = tokenPart(token);
          container.insertBefore(newPart, part);
          var tokensize = token.value.length;
          var offset = 0;
          while (tokensize > 0) {
            part = parts.get();
            var partsize = part.currentText.length;
            replaceSelection(part.firstChild, newPart.firstChild, tokensize, offset);
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

    return {left: lines,
            node: parts.get(),
            dirty: lineDirty};
  }

  return JSEditor;
}();
