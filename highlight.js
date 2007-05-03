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
        var text = document.createTextNode(line);
        parts.push(text);
        replaceSelection(node, text, line.length);
      }
    }
    return parts;
  }

  var leftOver = [];
  var closing = false;
  function next() {
    if (leftOver.length > 0)
      return leftOver.shift();

    while (true) {
      var node = nextNode();
      if (!node)
        throw StopIteration;

      if (node.nodeType == 3){
        leftOver = splitTextNode(node);
        closing = false;
        if (leftOver.length > 0)
          return leftOver.shift();
      }

      if (node.nodeName == "BR"){
        closing = true;
        return node;
      }
      else if (!closing && node.nodeName in newlineElements){
        closing = true;
        return withDocument(doc, BR);
      }
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
    else {
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
    var cContext = context, cLexical = lexical, ccc = clone(cc), cRegExp = tokens.regexp, cComment = tokens.inComment;
    return function(tokens){
      context = cContext;
      lexical = cLexical;
      cc = ccc;
      column = indented = 0;
      tokens.regexp = cRegExp;
      tokens.inComment = cComment;
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

function highlight(node, from, onlyDirtyLines, lines){
  if (!node.firstChild)
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
    return withDocument(node.ownerDocument, partial(SPAN, {"class": "part " + token.style}, token.value));
  }

  var lineDirty = false;
  var parsed = from ? from.parserFromHere(traverseDOM(from.nextSibling)) : parse(tokenize(stringCombiner(traverseDOM(node.firstChild))));
  var part = {
    current: null,
    forward: false,
    get: function(){
      if (!this.current){
        this.current = from ? from.nextSibling : node.firstChild;
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
      node.removeChild(this.current.nextSibling);
      this.forward = true;
    }
  };

  forEach(parsed, function(token){
    if (token.type == "newline"){
      if (part.get().nodeName != "BR")
        throw "Parser out of sync. Expected BR.";
      part.get().parserFromHere = parsed.copy();
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
      if (onlyDirtyLines && part.get().dirty)
        lineDirty = true;

      if (correctPart(token, part.get())){
        part.get().dirty = false;
        part.next();
      }
      else {
        var newPart = tokenPart(token);
        node.insertBefore(newPart, part.get());
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
  return lines;
}

function importCode(code, target){
  code = code.replace(/[ \t]/g, nbsp);
  replaceChildNodes(target, target.ownerDocument.createTextNode(code));
  highlight(target);
}

var highlightTimeout = null;
function scheduleHighlight(window, time){
  if (highlightTimeout)
    clearTimeout(highlightTimeout);
  highlightTimeout = setTimeout(partial(highlightDirtyLines, window, 10), time);
}

/*
function markSelection(window){
  function toplevelNode(from){
    while (from.parentNode){
      if (from.parentNode == body)
        return from;
      from = from.parentNode;
    }
  }

  var selection = rangeFromSelection(window);
  if (!selection)
    return;
  var body = window.document.body;
  var start = toplevelNode(selection.startNode),
    end = toplevelNode(selection.endNode);
  if (start && end){
    start.dirty = true;
    while (start != end) {
      start = start.nextSibling;
      start.dirty = true;
    }
  }
  scheduleHighlight(window, 400);
}

function highlightDirtyLines(window, amount){
  keepSelection = rangeFromSelection(window);
  var cursor = window.document.body.firstChild;
  for (; cursor && amount > 0; cursor = cursor.nextSibling) {
    if (cursor.dirty){
      var backUp = cursor.previousSibling;
      amount = highlight(window.document.body, cursor, true, amount);
      cursor = backUp ? backUp.nextSibling : window.document.body.firstChild;
    }
  }
  if (amount == 0)
    scheduleHighlight(window, 200);
}
*/

function highlightWindow(win) {
  var sel = markSelection(win);
  highlight(win.document.body);
  selectMarked(sel);
}

function addHighlighting(id){
  var textarea = $(id);
  var iframe = createDOM("IFRAME", {"class": "subtle-iframe", id: id, name: id});
  iframe.style.width = textarea.offsetWidth + "px";
  iframe.style.height = textarea.offsetHeight + "px";
  textarea.parentNode.replaceChild(iframe, textarea);

  var fdoc = iframe.contentWindow.document;
  fdoc.designMode = "on";
  fdoc.open();
  fdoc.write("<html><head><link rel=\"stylesheet\" type=\"text/css\" href=\"highlight.css\"/></head>");
  fdoc.write("<body class=\"subtle-iframe editbox\" spellcheck=\"false\"></body></html>");
  fdoc.close();

  function init(){
    importCode(textarea.value, fdoc.body);
//    connect(fdoc, "onmouseup", partial(markSelection, iframe.contentWindow));
//    connect(fdoc, "onkeyup", partial(markSelection, iframe.contentWindow));
  }

  if (document.all)
    init();
  else
    connect(iframe, "onload", function(){disconnectAll(iframe, "onload"); init();});
}
