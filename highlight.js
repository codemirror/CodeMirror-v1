var newlineElements = setObject("BR", "P", "DIV", "LI");

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
    if (text.length > 0)
      point(withDocument(owner, partial(SPAN, {"class": "part"}, text)));
  }

  function writeNode(node, c){
    if (node.nextSibling)
      c = push(writeNode, node.nextSibling, c);
    if (node.nodeType == 3){
      var text = node.nodeValue;
      var lines = text.split("\n");
      insertPart(lines[0]);
      for (var i = 1; i < lines.length; i++){
        insertNewline();
        insertPart(lines[i]);
      }
      return yield(text, c);
    }
    else{
      if (node.nodeName in newlineElements)
        c = chain(insertNewline, push(yield, "\n", c));
      if (node.firstChild)
        c = push(writeNode, node.firstChild, c);
      return c();
    }
  }

  function partNode(node){
    return node.nodeName == "SPAN" && node.childNodes.length == 1 &&
      node.firstChild.nodeType == 3 && hasElementClass(node, "part");
  }
  function newlineNode(node){
    return node.nodeName == "BR";
  }

  function scanNode(node, c){
    if (node.nextSibling)
      c = push(scanNode, node.nextSibling, c);
    if (partNode(node)){
      return yield(node.firstChild.nodeValue, c);
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

var keywordsA = setObject("if", "switch", "while", "catch");
var keywordsB = setObject("else", "do", "try", "finally"); 
var keywordsC = setObject("return", "new", "delete");
var atoms = setObject("true", "false", "undefined", "null");
var isOperatorChar = matcher(/[\+\-\*\&\%\/=<>]/);
var isDigit = matcher(/[0-9]/);
function isWhiteSpace(ch){
  return ch != "\n" && /\s/.test(ch);
}

function tokenize(source){
  source = peekIter(iter(source), "");

  function readWhile(test, start){
    while(true){
      var next = source.peek();
      if (next && test(next))
        start += source.next();
      else
        return start;
    }
  }
  function readUntilUnescaped(end, start){
    var escaped = false;
    while(true){
      var next = source.peek();
      if (next == "\n" || !next)
        return start;
      start += source.next();
      if (next == end && !escaped)
        return start;
      escaped = next == "\\";
    }
  }

  function wordType(word){
    function result(type, style){
      return {type: type, style: style, value: word};
    }
    if (word == "function")
      return result("function", "keyword");
    if (word == "var")
      return result("var", "keyword");
    if (word == "in")
      return result("operator", "operator");
    if (word in keywordsA)
      return result("keyword a", "keyword");
    if (word in keywordsB)
      return result("keyword b", "keyword");
    if (word in keywordsC)
      return result("keyword c", "keyword");
    if (word in atoms)
      return result("atom", "atom");
    else
      return result("variable", "variable");
  }

  function readNumber(first){
    var buffer = readWhile(isDigit, first);
    if (source.peek() == ".")
      buffer = readWhile(isDigit, buffer + source.next());
    if (source.peek() == "e" || source.peek() == "E")
      buffer = readWhile(isDigit, buffer + source.next() + source.next());
    return {type: "number", style: "atom", value: buffer};
  }
  function readWord(first){
    var word = readWhile(matcher(/[\w$]/), first);
    return wordType(word);
  }
  function readRegexp(first){
    var regexp = readUntilUnescaped("/", first);
    return {type: "regexp", style: "string", value: readWhile(matcher(/[gi]/), regexp)};
  }
  function readMultilineComment(start){
    this.inComment = true;
    var maybeEnd = (start == "*");
    while(true){
      var next = source.peek();
      if (next == "\n")
        break;
      start += source.next();
      if (next == "/" && maybeEnd){
        this.inComment = false;
        break;
      }
      maybeEnd = next == "*";
    }
    return {type: "comment", style: "comment", value: start};
  }

  function next(){
    var ch = source.next();
    if (ch == "\n")
      return {type: "newline", style: "whitespace", value: "\n"};
    else if (this.inComment)
      return readMultilineComment.call(this, ch)
    else if (isWhiteSpace(ch))
      return {type: "whitespace", style: "whitespace", value: readWhile(isWhiteSpace, ch)};
    else if (ch == "\"")
      return {type: "string", style: "string", value: readUntilUnescaped("\"", ch)};
    else if (/[{}\(\),;:]/.test(ch))
      return {type: ch, style: "punctuation", value: ch};
    else if (isDigit(ch))
      return readNumber(ch);
    else if (ch == "/"){
      next = source.peek();
      if (next == "*")
        return readMultilineComment.call(this, ch);
      else if (next == "/")
        return {type: "comment", style: "comment", value: readUntilUnescaped("\n", ch)};
      else if (this.regexpAllowed)
        return readRegexp(ch);
      else
        return {type: "operator", style: "operator", value: readWhile(isOperatorChar, ch)};
    }
    else if (isOperatorChar(ch))
      return {type: "operator", style: "operator", value: readWhile(isOperatorChar, ch)};
    else
      return readWord(ch);
  }
  return {next: next, regexpAllowed: true, inComment: false};
}

var atomicTypes = setObject("atom", "number", "variable", "string", "regexp");  

function parse(charSource){
  var cc = [statements];
  var context = null;
  var lexical = null;
  var tokens = tokenize(iter(charSource));
  var column = 0;
  var indented = 0;

  function next(){
    var nextaction = cc[cc.length - 1];
    tokens.regexpAllowed = !nextaction.noRegexp;

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
      var result = nextaction(token.type, token.value);
      if (result.pop)
        cc.pop();
      for (var i = result.follow.length - 1; i >= 0; i--)
        cc.push(result.follow[i]);
      if (result.yield)
        return token;
      nextaction = cc[cc.length - 1];
    }
  }

  function sub(){
    return {follow: arguments,
            yield: false,
            pop: false};
  }
  function cont(){
    return {follow: arguments,
            yield: true,
            pop: true};
  }
  function stay(){
    return {follow: [],
            yield: true,
            pop: false};
  }
  function done(){
    return {follow: arguments,
            yield: false,
            pop: true};
  }

  function pushcontext(){
    context = {prev: context, vars: {}};
    return done();
  }
  function popcontext(){
    context = context.prev;
    return done();
  }
  function register(varname){
    if (context)
      context.vars[varname] = true;
  }

  function pushlex(type){
    return function(){
      lexical = {prev: lexical, indented: indented, column: column, type: type};
      return done();
    };
  }
  function poplex(){
    lexical = lexical.prev;
    return done();
  }

  function expect(wanted){
    return function(type){
      if (type == wanted) return cont();
      return stay();
    };
  }

  function statements(type){
    return sub(statement);
  }
  function statement(type){
    if (type == "var") return cont(pushlex("var"), vardef1, expect(";"), poplex);
    if (type == "keyword a") return cont(pushlex("expr"), expression, statement, poplex);
    if (type == "keyword b") return cont(pushlex("expr"), statement, poplex);
    if (type == "function") return cont(pushlex("expr"), functiondef, poplex);
    if (type == "{") return cont(pushlex("{"), block, poplex);
    return done(pushlex("expr"), expression, expect(";"), poplex);
  }
  function expression(type){
    if (type in atomicTypes) {return cont(maybeoperator);}
    if (type == "function") return cont(functiondef);
    if (type == "keyword c") return cont(expression);
    if (type == "(") return cont(pushlex("("), expression, expect(")"), poplex);
    if (type == "operator") return stay();
    return done();
  }
  function maybeoperator(type){
    if (type == "operator") return cont(expression);
    if (type == "(") return cont(pushlex("("), expression, commaseparated, expect(")"), poplex);
    return done();
  }
  maybeoperator.noRegexp = true;
  function commaseparated(type){
    if (type == ",") return cont(expression, commaseparated);
    return done();
  }
  function block(type){
    if (type == "}") return cont();
    return sub(statement);
  }
  function vardef1(type, value){
    if (type == "variable"){
      register(value);
      return cont(vardef2);
    }
    return done();
  }
  function vardef2(type, value){
    if (value == "=")
      return cont(expression, vardef2);
    if (type == ",")
      return cont(vardef1);
    return done();
  }
  function functiondef(type, value){
    if (type == "variable"){
      register(value);
      return cont(functiondef);
    }
    if (type == "(")
      return cont(pushcontext, arglist1, expect(")"), statement, popcontext);
    return done();
  }
  function arglist1(type, value){
    if (type == "variable"){
      register(value);
      return cont(arglist2);
    }
    return done();
  }
  function arglist2(type){
    if (type == ",")
      return cont(arglist1);
    return done();
  }

  return {next: next};
}

function highlight(node){
  if (!node.firstChild)
    return;
  
  function partLength(part){
    return part.firstChild.nodeValue.length;
  }
  function correctPart(token, part){
    return part.firstChild.nodeValue == token.value && hasElementClass(part, token.style);
  }
  function shortenPart(part, minus){
    part.firstChild.nodeValue = part.firstChild.nodeValue.substring(minus);
  }
  function tokenPart(token){
    return withDocument(node.ownerDocument, partial(SPAN, {"class": "part " + token.style}, token.value));
  }

  var parsed = parse(iconcat(traverseDOM(node.firstChild)));
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
          var partsize = partLength(part.get());
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
  code = code.replace(/[ \t]/g, String.fromCharCode(160));
  replaceChildNodes(target, target.ownerDocument.createTextNode(code));
  highlight(target);
}

function addHighlighting(id){
  var textarea = $(id);
  var iframe = createDOM("IFRAME", {src: "editframe.html", "class": "subtle-iframe", id: id, name: id});
  iframe.style.width = textarea.offsetWidth + "px";
  iframe.style.height = textarea.offsetHeight + "px";
  textarea.parentNode.replaceChild(iframe, textarea);
  var frameload = connect(iframe, "onload", stage2);

  function stage2(){
    disconnect(frameload);
    var fdoc = frames[id].document;
    if (!document.all)
      fdoc.designMode = "on";
    importCode(textarea.value, fdoc.body);
  }
}
