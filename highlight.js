var newlineElements = setObject("P", "DIV", "LI");

function scanDOM(root) {
  var doc = root.ownerDocument;
  var current = root;
  while (current.firstChild)
    current = current.firstChild;

  function nextNode() {
    var result = current;
    if (current) {
      if (current.nextSibling) {
        current = current.nextSibling;
        while (current.firstChild)
          current = current.firstChild;
      }
      else {
        current = current.parentNode;
      }
    }
    return result;
  }

  function splitTextNode(node) {
    var text = node.nodeValue;
    if (text == "")
      return [];
    if (text.indexOf("\n") == -1)
      return [node];

    var parts = [];
    var lines = text.split("\n");
    for (var i = 0; i != lines.length; i++) {
      if (i > 0){
        var br = withDocument(doc, BR);
        parts.push(br);
        replaceSelection(node, br, 1);
      }
      var line = lines[i];
      if (line.length > 0) {
        var text = doc.createTextNode(line);
        parts.push(text);
        replaceSelection(node, text, line.length);
      }
    }
    return parts;
  }

  var leftOver = [];
  function next() {
    if (leftOver.length > 0)
      return leftOver.shift();

    while (true) {
      var node = nextNode();
      if (!node)
        throw StopIteration;

      if (node.nodeType == 3){
        leftOver = splitTextNode(node);
        if (leftOver.length > 0)
          return leftOver.shift();
      }

      if (node.nodeName == "BR")
        return node;
      else if (node.nodeName in newlineElements)
        return withDocument(doc, BR);
    }
  }
  return {next: next};
}

function traverseDOM(start){
  function yield(value, c){cc = c; return value;}
  function push(fun, arg, c){return function(){return fun(arg, c);};}
  function chain(fun, c){return function(){fun(); return c();};}
  var cc = push(scanNode, start, function(){throw StopIteration;});
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

  function insertNewline(br){
    br.dirty = true;
    point(br);
    return "\n";
  }
  function insertPart(text){
    var part = withDocument(owner, partial(SPAN, {"class": "part"}, text));
    part.text = text.nodeValue;
    part.dirty = true;
    point(part);
    return part.text;
  }

  function writeNode(node, c){
    var parts = scanDOM(node);
    function handlePart(part){
      if (part.nodeName == "BR")
        return push(yield, insertNewline(part), iter());
      else
        return push(yield, insertPart(part), iter());
    }
    function iter(){
      return tryNext(parts, handlePart, constantly(c));
    }
    return iter()();
  }

  function partNode(node){
    if (node.nodeName == "SPAN" && node.childNodes.length == 1 && node.firstChild.nodeType == 3){
      node.text = node.firstChild.nodeValue;
      return node.text.length > 0;
    }
    return false;
  }
  function newlineNode(node){
    return node.nodeName == "BR";
  }

  function scanNode(node, c){
    if (node.nextSibling)
      c = push(scanNode, node.nextSibling, c);
    if (partNode(node)){
      return yield(node.text, c);
    }
    else if (newlineNode(node)){
      return yield("\n", c);
    }
    // The check for parentNode is a hack to prevent weird problem in
    // FF where empty nodes seem to spontaneously remove themselves
    // from the DOM tree.
    else if (node.parentNode) {
      point = pointAt(node);
      removeElement(node);
      return writeNode(node, c);
    }
  }

  return {next: function(){return cc();}};
}

var atomicTypes = setObject("atom", "number", "variable", "string", "regexp");  

function parse(tokens){
  var cc = [statements];
  var consume, markdef;
  var context = null;
  var lexical = null;
  var column = 0;
  var indented = 0;

  var parser = {next: next, copy: copy};

  function next(){
    var token = tokens.next();
    if (token.type == "whitespace" && column == 0)
      indented = token.value.length;
    column += token.value.length;
    if (token.type == "newline"){
      indented = column = 0;
      if (lexical && !("align" in lexical))
        lexical.align = false;
    }
    if (token.type == "whitespace" || token.type == "newline" || token.type == "comment")
      return token;
    if (lexical && !("align" in lexical))
      lexical.align = true;

    while(true){
      consume = markdef = false;
      cc.pop()(token.type, token.name);
      if (consume){
        if (token.type == "variable") {
          if (markdef)
            token.style = "variabledef";
          else if (inScope(token.name))
            token.style = "localvariable";
        }
        return token;
      }
    }
  }
  function copy(){
    var _context = context, _lexical = lexical, _cc = copyArray(cc), _regexp = tokens.regexp, _comment = tokens.inComment;

    return function(newTokens){
      context = _context;
      lexical = _lexical;
      cc = copyArray(_cc);
      column = indented = 0;
      tokens = newTokens;
      tokens.regexp = _regexp;
      tokens.inComment = _comment;
      return parser;
    };
  }

  function push(fs){
    for (var i = fs.length - 1; i >= 0; i--)
      cc.push(fs[i]);
  }
  function cont(){
    push(arguments);
    consume = true;
  }
  function pass(){
    push(arguments);
    consume = false;
  }

  function pushcontext(){
    context = {prev: context, vars: {}};
  }
  function popcontext(){
    context = context.prev;
  }
  function register(varname){
    if (context){
      markdef = true;
      context.vars[varname] = true;
    }
  }
  function inScope(varname){
    var cursor = context;
    while (cursor) {
      if (cursor.vars[varname])
        return true;
      cursor = cursor.prev;
    }
    return false;
  }

  function pushlex(type){
    return function(){
      lexical = {prev: lexical, indented: indented, column: column, type: type};
    };
  }
  function poplex(){
    lexical = lexical.prev;
  }

  function expect(wanted){
    return function(type){
      if (type == wanted) cont();
      else cont(arguments.callee);
    };
  }

  function statements(type){
    return pass(statement, statements);
  }
  function statement(type){
    if (type == "var") cont(pushlex("expr"), vardef1, expect(";"), poplex);
    else if (type == "keyword a") cont(pushlex("expr"), expression, statement, poplex);
    else if (type == "keyword b") cont(pushlex("expr"), statement, poplex);
    else if (type == "{") cont(pushlex("block"), block, poplex);
    else if (type == "function") cont(functiondef);
    else pass(pushlex("expr"), expression, expect(";"), poplex);
  }
  function expression(type){
    if (type in atomicTypes) cont(maybeoperator);
    else if (type == "function") cont(functiondef);
    else if (type == "keyword c") cont(expression);
    else if (type == "(") cont(pushlex("block"), expression, expect(")"), poplex);
    else if (type == "operator") cont(expression);
  }
  function maybeoperator(type){
    if (type == "operator") cont(expression);
    else if (type == "(") {cont(pushlex("block"), expression, commaseparated, expect(")"), poplex)};
  }
  function commaseparated(type){
    if (type == ",") cont(expression, commaseparated);
  }
  function block(type){
    if (type == "}") cont();
    else pass(statement, block);
  }
  function vardef1(type, value){
    if (type == "variable"){register(value); cont(vardef2);}
    else cont();
  }
  function vardef2(type, value){
    if (value == "=") cont(expression, vardef2);
    else if (type == ",") cont(vardef1);
  }
  function functiondef(type, value){
    if (type == "variable"){register(value); cont(functiondef);}
    else if (type == "(") cont(pushcontext, arglist1, expect(")"), statement, popcontext);
  }
  function arglist1(type, value){
    if (type == "variable"){register(value); cont(arglist2);}
  }
  function arglist2(type){
    if (type == ",") cont(arglist1);
  }

  return parser;
}

function JSEditor(place, width, height, content) {
  this.frame = createDOM("IFRAME", {"style": "border: 0; width: " + width + "px; height: " + height + "px;"});
  place(this.frame);
  this.win = this.frame.contentWindow;
  this.doc = this.win.document;
  this.doc.designMode = "on";
  this.doc.open();
  this.doc.write("<html><head><link rel=\"stylesheet\" type=\"text/css\" href=\"highlight.css\"/></head>" +
                 "<body class=\"editbox\" spellcheck=\"false\"></body></html>");
  this.doc.close();

  this.dirty = [];

  if (document.selection) // better check?
    this.init(content);
  else
    connect(this.frame, "onload", bind(function(){disconnectAll(this.frame, "onload"); this.init(content);}, this));
}

JSEditor.prototype = {
  linesPerShot: 10,
  shotDelay: 300,

  init: function (code) {
    if (code)
      this.importCode(code);
    connect(this.doc, "onmouseup", bind(this.markCursorDirty, this));
    connect(this.doc, "onkeyup", bind(this.handleKey, this));
  },

  importCode: function(code) {
    code = code.replace(/[ \t]/g, nbsp);
    replaceChildNodes(this.doc.body, this.doc.createTextNode(code));
    exhaust(traverseDOM(this.doc.body.firstChild));
    if (this.doc.body.firstChild){
      this.addDirtyNode(this.doc.body.firstChild);
      this.scheduleHighlight();
    }
  },

  handleKey: function(event) {
/*    if (event.key().string == "KEY_ENTER")
      this.indentAtCursor();
    else*/
      this.markCursorDirty();
  },

  highlight: highlight,

  topLevelNode: function(from) {
    while (from && from.parentNode != this.doc.body)
      from = from.parentNode;
    return from;
  },

  markCursorDirty: function() {
    var cursor = this.topLevelNode(cursorPos(this.frame.contentWindow));
    if (cursor) {
      this.scheduleHighlight();
      this.addDirtyNode(cursor);
    }
  },

  addDirtyNode: function(node) {
    if (!member(this.dirty, node)){
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
      if (found.dirty && found.parentNode)
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
  var doc = this.doc;
  var body = doc.body;
  if (!body.firstChild)
    return;
  while (from && !from.parserFromHere)
    from = from.previousSibling;
  if (from && !from.nextSibling)
    return;

  function correctPart(token, part){
    return !part.reduced && part.text == token.value && hasClass(part, token.style);
  }
  function shortenPart(part, minus){
    part.text = part.text.substring(minus);
    part.reduced = true;
  }
  function tokenPart(token){
    return withDocument(doc, partial(SPAN, {"class": "part " + token.style}, token.value));
  }

  var parsed = from ? from.parserFromHere(tokenize(stringCombiner(traverseDOM(from.nextSibling))))
                    : parse(tokenize(stringCombiner(traverseDOM(body.firstChild))));

  var part = {
    current: null,
    forward: false,
    get: function(){
      if (!this.current){
        this.current = from ? from.nextSibling : body.firstChild;
      }
      else if (this.forward){
        this.forward = false;
        this.current = this.current.nextSibling;
      }
      return this.current;
    },
    next: function(){
      if (this.forward)
        this.get();
      this.forward = true;
    },
    remove: function(){
      this.current = this.get().previousSibling;
      body.removeChild(this.current.nextSibling);
      this.forward = true;
    }
  };

  var lineDirty = false;

  forEach(parsed, function(token){
    if (token.type == "newline"){
      if (part.get().nodeName != "BR")
        throw "Parser out of sync. Expected BR.";
      part.get().parserFromHere = parsed.copy();
      if (part.get().dirty)
        lineDirty = true;
      part.get().dirty = false;
      if ((lines !== undefined && --lines <= 0) ||
          (onlyDirtyLines && !lineDirty && !part.get().dirty))
        throw StopIteration;
      lineDirty = false;
      part.next();
    }
    else {
      if (part.get().nodeName != "SPAN")
        throw "Parser out of sync. Expected SPAN.";
      if (part.get().dirty)
        lineDirty = true;

      if (correctPart(token, part.get())){
        part.get().dirty = false;
        part.next();
      }
      else {
        lineDirty = true;
        var newPart = tokenPart(token);
        body.insertBefore(newPart, part.get());
        var tokensize = token.value.length;
        while (tokensize > 0) {
          var partsize = part.get().text.length;
          replaceSelection(part.get().firstChild, newPart.firstChild, tokensize);
          if (partsize > tokensize){
            shortenPart(part.get(), tokensize);
            tokensize = 0;
          }
          else {
            tokensize -= partsize;
            part.remove();
          }
        }
      }
    }
  });

  return {left: lines,
          node: part.get(),
          dirty: lineDirty};
}
