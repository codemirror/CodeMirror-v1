/**
 * Copyright (C) 2010 eXo Platform SAS.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 *
 */

/* Tokenizer for Xquery code */

var tokenizeXquery = (function() {
  // Advance the stream until the given character (not preceded by a
  // backslash) is encountered, or the end of the line is reached.
  function nextUntilUnescaped(source, end) {
    var escaped = false;
    var next;
    while(!source.endOfLine()){
      var next = source.next();
      if (next == end && !escaped)
        return false;
        escaped = !escaped && next == "\\";
    }
    return escaped;
  }

  // A map of Xquery's keywords. The a/b/c keyword distinction is
  // very rough, but it gives the parser enough information to parse
  // correct code correctly (we don't care that much how we parse
  // incorrect code). The style information included in these objects
  // is used by the highlighter to pick the correct CSS style for a
  // token.
  var keywords = function(){
    function result(type, style){
      return {type: type, style: style};
    }

    var allKeywords = {};
    
    // ------------------- java keywords
    var keywordsList = {};
    
    // keywords that take a parenthised expression, and then a statement (if)
    keywordsList['javaKeywordA'] = new Array('if', 'switch', 'while');
    
    // keywords that take just a statement (else)
    keywordsList['javaKeywordB'] = new Array('else', 'do', 'try', 'finally');

    // keywords that optionally take an expression, and form a statement (return)
    keywordsList['javaKeywordC'] = new Array('attribute', 'element', 'let', 'implements', 'import', 'new', 'package', 'return', 'super', 'this', 'throws');

    for (var keywordType in keywordsList) {
        for (var i = 0; i < keywordsList[keywordType].length; i++) {
            allKeywords[keywordsList[keywordType][i]] = result(keywordType, "javaKeyword");
        }
    }

    keywordsList = {};
    
    // java atom
    keywordsList['javaAtom'] = new Array('null', 'true', 'false');
    for (var keywordType in keywordsList) {
        for (var i = 0; i < keywordsList[keywordType].length; i++) {
            allKeywords[keywordsList[keywordType][i]] = result(keywordType, keywordType);
        }
    }

    keywordsList = {};

    // java modifiers
    keywordsList['javaModifier'] = new Array('function', 'xquery', 'version');

    // java types
    keywordsList['javaType'] = new Array('boolean', 'byte', 'char', 'enum', 'double', 'float', 'int', 'interface', 'long', 'short', 'void', 'class');
    for (var keywordType in keywordsList) {
        for (var i = 0; i < keywordsList[keywordType].length; i++) {
            allKeywords[keywordsList[keywordType][i]] = result('function', keywordType);
        }
    }

    // other java keywords
    allKeywords = objectConcat(allKeywords, {
        "catch": result("catch", "javaKeyword"),
        "for": result("for", "javaKeyword"),
        "case": result("case", "javaKeyword"),
        "default": result("default", "javaKeyword"),
        "instanceof": result("operator", "javaKeyword")         
    });

    // ------------------- xquery keywords
    var keywordsList = {};

    // GJDK methods
    keywordsList['xqueryGsdkMethod'] = new Array('abs','any','append','asList','asWritable','collect','compareTo','count','div','dump','each','eachByte','eachFile','eachLine','every','find','findAll','getAt','getErr','getIn','getOut','getText','grep','inject','inspect','intersect','isCase','join','leftShift','minus','multiply','mixin','newInputStream','newOutputStream','newPrintWriter','newReader','newWriter','next','plus','pop','power','previous','print','println','push','putAt','readBytes','readLines','reverse','reverseEach','round','size','sort','splitEachLine','step','subMap','times','toInteger','toList','tokenize','upto','waitForOrKill','withPrintWriter','withReader','withStream','withWriterAppend','write','writeLine');
    for (var i = 0; i < keywordsList['xqueryGsdkMethod'].length; i++) {
        allKeywords[keywordsList['xqueryGsdkMethod'][i]] = result("xqueryGsdkMethod", "xqueryGsdkMethod");
    }

    // keywords that optionally take an expression, and form a statement (return)
    keywordsList['xqueryKeywordC'] = new Array('assert', 'property');
    for (var i = 0; i < keywordsList['xqueryKeywordC'].length; i++) {
        allKeywords[keywordsList['xqueryKeywordC'][i]] = result("xqueryKeywordC", "xqueryKeyword");
    }
    
    // other xquery keywords
    allKeywords = objectConcat(allKeywords, {
        "as": result("operator", "xqueryKeyword"),
        "in": result("operator", "xqueryKeyword"),
        "function": result("function", "xqueryKeyword")
    });

    return allKeywords;
  }();

  // Some helper regexp matchers.
  var isOperatorChar = /[+\-*&%\/=<>!?|]/;
  var isDigit = /[0-9]/;
  var isHexDigit = /^[0-9A-Fa-f]$/;
  var isWordChar = /[\w\$_]/;
  var isXqueryVariableChar = /[\w\.()\[\]{}]/;
  var isPunctuation = /[\[\]{}\(\),;\:\.]/;
  var isStringDelimeter = /^[\/'"]$/;
  var isRegexpDelimeter = /^[\/'$]/;

  // Wrapper around xqueryToken that helps maintain parser state (whether
  // we are inside of a multi-line comment and whether the next token
  // could be a regular expression).
  function xqueryTokenState(inside, regexp) {
    return function(source, setState) {
      var newInside = inside;
      var type = xqueryToken(inside, regexp, source, function(c) {newInside = c;});
      var newRegexp = type.type == "operator" || type.type == "javaKeywordC" || type.type == "xqueryKeywordC" || type.type.match(/^[\[{}\(,;:]$/);
      if (newRegexp != regexp || newInside != inside)
        setState(xqueryTokenState(newInside, newRegexp));
      return type;
    };
  }

  // The token reader, inteded to be used by the tokenizer from
  // tokenize.js (through xqueryTokenState). Advances the source stream
  // over a token, and returns an object containing the type and style
  // of that token.
  function xqueryToken(inside, regexp, source, setInside) {
    function readHexNumber(){
      setInside(null);
      source.next(); // skip the 'x'
      source.nextWhileMatches(isHexDigit);
      return {type: "number", style: "xqueryNumber"};
    }

    function readNumber() {
      setInside(null);
      source.nextWhileMatches(isDigit);
      if (source.equals(".")){
        source.next();
        
        // read ranges
        if (source.equals("."))
          source.next();
          
        source.nextWhileMatches(isDigit);
      }
      if (source.equals("e") || source.equals("E")){
        source.next();
        if (source.equals("-"))
          source.next();
        source.nextWhileMatches(isDigit);
      }
      return {type: "number", style: "xqueryNumber"};
    }
    // Read a word, look it up in keywords. If not found, it is a
    // variable, otherwise it is a keyword of the type found.
    function readWord() {
      setInside(null);      
      source.nextWhileMatches(isWordChar);
      var word = source.get();
      var known = keywords.hasOwnProperty(word) && keywords.propertyIsEnumerable(word) && keywords[word];
      return known ? {type: known.type, style: known.style, content: word} :
      {type: "variable", style: "xqueryVariable", content: word};
    }
    
    
    // read regexp like /\w{1}:\\.+\\.+/
    function readRegexp() {
      // go to the end / not \/
      nextUntilUnescaped(source, "/");
      
      return {type: "regexp", style: "xqueryRegexp"};
    }
    
    // Mutli-line comments are tricky. We want to return the newlines
    // embedded in them as regular newline tokens, and then continue
    // returning a comment token for every line of the comment. So
    // some state has to be saved (inside) to indicate whether we are
    // inside a /* */ sequence.
    function readMultilineComment(start){
      var newInside = "(:";
      var maybeEnd = (start == ":");
      while (true) {
        if (source.endOfLine())
          break;
        var next = source.next();
        if (next == ")" && maybeEnd){
          newInside = null;
          break;
        }
        maybeEnd = (next == ":");
      }
      setInside(newInside);
      return {type: "comment", style: "xqueryComment"};
    }
    
    function readOperator() {
      if (ch == "=") 
        setInside("=")
      else if (ch == "~")
        setInside("~")
      else if (ch == ":" && source.equals("=")) {
          setInside(null);      
          source.nextWhileMatches(/[:=]/);
          var word = source.get();
          return {type: "operator", style: "xqueryOperator", content: word};                  
      }
      else setInside(null);

      return {type: "operator", style: "xqueryOperator"};
    }
    function readString(quote) {           
      var newInside = quote;
      if (source.endOfLine()) {  // finish String coloring after the end of the line
        newInside = null;
      } else {     
        var next = source.next();
        
        // test if this is  \", \' or \/ inside the String 
        if (next == "\\" && source.equals(quote)) {
          newInside = "\\" + quote;
          source.next();
        } else if (next == quote) {  // finish String coloring after the ', " or /, not \', \", \/
          newInside = null;
        }
      }

      setInside(newInside);
      return {type: "string", style: "xqueryString"};
    }
    
    function readVariable() {
        setInside(null);      
        source.nextWhileMatches(isWordChar);
        var word = source.get();
        return {type: "variable", style: "xqueryVariable", content: word};        
    }
    


    // Fetch the next token. Dispatches on first character in the
    // stream, or first two characters when the first is a slash.        

    // to avoid the considering of \", \', \/ as the end of String inside the String
    if (inside == '\\"' || inside == "\\'" || inside == "\\/") {
      setInside(inside[1]);  // set 'inside' = ', ", /
      return {type: "string", style: "xqueryString"};      
    }

    // test if we within the String
    if (isStringDelimeter.test(inside))
      return readString(inside);

      
    var ch = source.next();
        
    if (inside == "(:")  // test if this is the start of Multiline Comment
      return readMultilineComment(ch);
      
    else if (ch == "'" || ch == '"') {   // test if this is the start of String
      setInside(ch);
      return {type: "string", style: "xqueryString"};
    }

    // test if this is range 
    else if ( ch == "." && source.equals(".")) {
      source.next();
      return {type: "..", style: "xqueryOperator"};      
    }
    
    else if (ch == "("){
      if (source.equals(":"))
      { source.next(); return readMultilineComment(ch); }
      // else if (source.equals("/"))
      // { nextUntilUnescaped(source, null); return {type: "comment", style: "xqueryComment"};}
      // else if (inside == "=" || inside == "~" )   // read slashy string like (def winpathSlashy=/C:\windows\system32/) not def c = a / 5;
      //   return readRegexp();  
      else return readOperator();
    }
    else if (ch == "$")
        return readVariable();
    else if (ch == ":" && source.equals("="))
        return readOperator();


    // with punctuation, the type of the token is the symbol itself
    else if (isPunctuation.test(ch))
      return {type: ch, style: "xqueryPunctuation"};
    else if (ch == "0" && (source.equals("x") || source.equals("X")))
      return readHexNumber();
    else if (isDigit.test(ch))
      return readNumber();

    else if (ch == "~") { 
      setInside("~");  // prepare to read slashy string like ~ /\w{1}:\\.+\\.+/ 
      return readOperator(ch);
    }       
    else if (isOperatorChar.test(ch))
      return readOperator(ch);
    else
      return readWord();
  }

  // returns new object = object1 + object2
  function objectConcat(object1, object2) {
    for(var name in object2) {
        if (!object2.hasOwnProperty(name)) continue;
        if (object1.hasOwnProperty(name)) continue;
        object1[name] = object2[name];
    }
    return object1;
  }

  // The external interface to the tokenizer.
  return function(source, startState) {
    return tokenizer(source, startState || xqueryTokenState(false, true));
  };
})();