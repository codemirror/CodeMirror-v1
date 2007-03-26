var newlineElements = setObject("BR", "P", "DIV", "LI");
var nbsp = String.fromCharCode(160);

function scanDOM(root){
  function yield(value, c){cc = c; return value;}
  function push(fun, arg, c){return function(){return fun(arg, c);};}
  var cc = push(scanNode, root, function(){throw StopIteration;});
  
  function scanNode(node, c){
    if (node.nextSibling)
      c = push(scanNode, node.nextSibling, c);
    if (node.nodeType == 3){
      var lines = node.nodeValue.split("\n");
      for (var i = lines.length - 1; i >= 0; i--){
        c = push(yield, lines[i], c);
        if (i > 0)
          c = push(yield, "\n", c);
      }
    }
    else{
      if (node.nodeName in newlineElements)
        c = push(yield, "\n", c);
      if (node.firstChild)
        c = push(scanNode, node.firstChild, c);
    }
    return c();
  }
  return {next: function(){return cc();}};
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

  function insertNewline(){
    point(withDocument(owner, BR));
  }
  function insertPart(text){
    if (text.length > 0){
      var part = withDocument(owner, partial(SPAN, {"class": "part"}, text));
      part.text = text;
      point(part);
    }
  }

  function writeNode(node, c){
    var parts = scanDOM(node);
    function handlePart(part){
      if (part == "\n")
        insertNewline();
      else
        insertPart(part);
      return push(yield, part, iter());
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

var keywords = function(){
  function result(type, style){
    return {type: type, style: style};
  }
  var keywordA = result("keyword a", "keyword");
  var keywordB = result("keyword b", "keyword");
  var keywordC = result("keyword c", "keyword");
  var operator = result("operator", "keyword");
  var atom = result("atom", "atom");
  return {
    "if": keywordA, "switch": keywordA, "while": keywordA, "catch": keywordA, "for": keywordA,
    "else": keywordB, "do": keywordB, "try": keywordB, "finally": keywordB,
    "return": keywordC, "new": keywordC, "delete": keywordC, "break": keywordC, "continue": keywordC,
    "in": operator, "typeof": operator,
    "var": result("var", "keyword"), "function": result("function", "keyword"),
    "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom
  };
}();

var isOperatorChar = matcher(/[\+\-\*\&\%\/=<>!\?]/);
var isDigit = matcher(/[0-9]/);
var isWordChar = matcher(/[\w$_]/);
function isWhiteSpace(ch){
  // Unfortunately, IE's regexp matcher thinks non-breaking spaces
  // aren't whitespace.
  return ch != "\n" && (ch == nbsp || /\s/.test(ch));
}

function tokenize(source){
  source = stringCombiner(source);

  function result(type, style, base){
    nextWhile(isWhiteSpace);
    var value = {type: type, style: style, value: (base ? base + source.get() : source.get())};
    if (base) value.name = base;
    return value;
  }

  function nextWhile(test){
    var next;
    while((next = source.peek()) && test(next))
      source.next();
  }
  function nextUntilUnescaped(end){
    var escaped = false;
    var next;
    while((next = source.peek()) && next != "\n"){
      source.next();
      if (next == end && !escaped)
        break;
      escaped = next == "\\";
    }
  }

  function readNumber(){
    nextWhile(isDigit);
    if (source.peek() == "."){
      source.next();
      nextWhile(isDigit);
    }
    if (source.peek() == "e" || source.peek() == "E"){
      source.next();
      if (source.peek() == "-")
        source.next();
      nextWhile(isDigit);
    }
    return result("number", "atom");
  }
  function readWord(){
    nextWhile(isWordChar);
    var word = source.get();
    var known = keywords[word];
    return known ? result(known.type, known.style, word) : result("variable", "variable", word);
  }
  function readRegexp(){
    nextUntilUnescaped("/");
    nextWhile(matcher(/[gi]/));
    return result("regexp", "string");
  }
  function readMultilineComment(start){
    this.inComment = true;
    var maybeEnd = (start == "*");
    while(true){
      var next = source.peek();
      if (next == "\n")
        break;
      source.next();
      if (next == "/" && maybeEnd){
        this.inComment = false;
        break;
      }
      maybeEnd = next == "*";
    }
    return result("comment", "comment");
  }

  function next(){
    var ch = source.next();
    if (ch == "\n")
      return {type: "newline", style: "whitespace", value: source.get()};
    else if (this.inComment)
      return readMultilineComment.call(this, ch);
    else if (isWhiteSpace(ch))
      return nextWhile(isWhiteSpace) || result("whitespace", "whitespace");
    else if (ch == "\"")
      return nextUntilUnescaped("\"") || result("string", "string");
    else if (/[\[\]{}\(\),;\:]/.test(ch))
      return result(ch, "punctuation");
    else if (isDigit(ch))
      return readNumber();
    else if (ch == "/"){
      next = source.peek();
      if (next == "*")
        return readMultilineComment.call(this, ch);
      else if (next == "/")
        return nextUntilUnescaped(null) || result("comment", "comment");
      else if (this.regexpAllowed)
        return readRegexp();
      else
        return nextWhile(isOperatorChar) || result("operator", "operator");
    }
    else if (isOperatorChar(ch))
      return nextWhile(isOperatorChar) || result("operator", "operator");
    else
      return readWord();
  }

  return {next: next, regexpAllowed: true, inComment: false};
}

var atomicTypes = setObject("atom", "number", "variable", "string", "regexp");  

function parse(source){
  var cc = [statements];
  var consume;
  var context = null;
  var lexical = null;
  var tokens = tokenize(source);
  var column = 0;
  var indented = 0;

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
      consume = false;
      cc.pop()(token.type, token.name);
      if (consume)
        return token;
    }
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
    if (context)
      context.vars[varname] = true;
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
    else pass(pushlex("expr"), expression, expect(";"), poplex);
  }
  function expression(type){
    if (type in atomicTypes) {tokens.regexpAllowed = false; cont(maybeoperator);}
    else if (type == "function") cont(functiondef);
    else if (type == "keyword c") cont(expression);
    else if (type == "(") cont(pushlex("block"), expression, expect(")"), poplex);
    else if (type == "operator") cont(expression);
    else if (type == ";") cont();
  }
  function maybeoperator(type){
    tokens.regexpAllowed = true;
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

  return {next: next};
}

function highlight(node){
  if (!node.firstChild)
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

  var parsed = parse(traverseDOM(node.firstChild));
  var part = {
    current: null,
    forward: false,
    get: function(){
      if (!this.current){
        this.current = node.firstChild;
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
      if (!(part.get().nodeName == "BR"))
        throw "Parser out of sync. Expected BR.";
      part.next();
    }
    else {
      if (!(part.get().nodeName == "SPAN"))
        throw "Parser out of sync. Expected SPAN.";
      if (correctPart(token, part.get())){
        part.next();
      }
      else {
        node.insertBefore(tokenPart(token), part.get());
        var tokensize = token.value.length;
        while (tokensize > 0) {
          var partsize = part.get().text.length;
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
}

function importCode(code, target){
  code = code.replace(/[ \t]/g, nbsp);
  replaceChildNodes(target, target.ownerDocument.createTextNode(code));
  highlight(target);
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
  }

  if (document.all)
    init();
  else
    connect(iframe, "onload", function(){disconnectAll(iframe, "onload"); init();});
}
