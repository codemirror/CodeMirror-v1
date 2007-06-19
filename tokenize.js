var nbsp = String.fromCharCode(160);

function matcher(regexp){
  return function(value){return regexp.test(value);};
}

function singleStringStream(string) {
  var pos = 0, start = 0;
  
  function peek() {
    if (pos < string.length)
      return string.charAt(pos);
    else
      return null;
  }

  function next() {
    if (pos >= string.length)
      throw StopIteration;
    return string.charAt(pos++);
  }

  function get() {
    var result = string.slice(start, pos);
    start = pos;
    return result;
  }

  return {peek: peek, next: next, get: get};
}

function multiStringStream(source){
  source = iter(source);
  var current = "", pos = 0;
  var peeked = null, accum = "";
  var result = {peek: peek, next: next, get: get};

  function peek(){
    if (!peeked)
      peeked = nextOr(result, null);
    return peeked;
  }
  function next(){
    if (peeked){
      var temp = peeked;
      peeked = null;
      return temp;
    }
    while (pos == current.length){
      accum += current;
      current = ""; // In case source.next() throws
      pos = 0;
      current = source.next();
    }
    return current.charAt(pos++);
  }
  function get(){
    var temp = accum;
    var realPos = peeked ? pos - 1 : pos;
    accum = "";
    if (realPos > 0){
      temp += current.slice(0, realPos);
      current = current.slice(realPos);
      pos = peeked ? 1 : 0;
    }
    return temp;
  }

  return result;
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
    "if": keywordA, "switch": keywordA, "while": keywordA, "with": keywordA,
    "else": keywordB, "do": keywordB, "try": keywordB, "finally": keywordB,
    "return": keywordC, "break": keywordC, "continue": keywordC, "new": keywordC, "delete": keywordC, "throw": keywordC,
    "in": operator, "typeof": operator, "instanceof": operator,
    "var": result("var", "keyword"), "function": result("function", "keyword"), "catch": result("catch", "keyword"),
    "for": result("for", "keyword"), "case": result("case", "keyword"),
    "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom, "Infinity": atom
  };
}();

var isOperatorChar = matcher(/[\+\-\*\&\%\/=<>!\?]/);
var isDigit = matcher(/[0-9]/);
var isHexDigit = matcher(/[0-9A-Fa-f]/);
var isWordChar = matcher(/[\w\$_]/);
function isWhiteSpace(ch){
  // Unfortunately, IE's regexp matcher thinks non-breaking spaces
  // aren't whitespace.
  return ch != "\n" && (ch == nbsp || /\s/.test(ch));
}

function tokenize(source){
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

  function readHexNumber(){
    source.next(); // skip the 'x'
    nextWhile(isHexDigit);
    return result("number", "atom");
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
    var known = keywords.hasOwnProperty(word) && keywords.propertyIsEnumerable(word) && keywords[word];
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
    var token = null;
    var ch = source.next();
    if (ch == "\n")
      token = {type: "newline", style: "whitespace", value: source.get()};
    else if (this.inComment)
      token = readMultilineComment.call(this, ch);
    else if (isWhiteSpace(ch))
      token = nextWhile(isWhiteSpace) || result("whitespace", "whitespace");
    else if (ch == "\"")
      token = nextUntilUnescaped("\"") || result("string", "string");
    else if (ch == "'")
      token = nextUntilUnescaped("'") || result("string", "string");
    else if (/[\[\]{}\(\),;\:\.]/.test(ch))
      token = result(ch, "punctuation");
    else if (ch == "0" && (source.peek() == "x" || source.peek() == "X"))
      token = readHexNumber();
    else if (isDigit(ch))
      token = readNumber();
    else if (ch == "/"){
      next = source.peek();
      if (next == "*")
        token = readMultilineComment.call(this, ch);
      else if (next == "/")
        token = nextUntilUnescaped(null) || result("comment", "comment");
      else if (this.regexp)
        token = readRegexp();
      else
        token = nextWhile(isOperatorChar) || result("operator", "operator");
    }
    else if (isOperatorChar(ch))
      token = nextWhile(isOperatorChar) || result("operator", "operator");
    else
      token = readWord();

    if (token.style != "whitespace" && token != "comment")
      this.regexp = token.type == "operator" || token.type == "keyword c" || token.type.match(/[\[{}\(,;:]/);
    return token;
  }

  return {next: next, regexp: true, inComment: false};
}
