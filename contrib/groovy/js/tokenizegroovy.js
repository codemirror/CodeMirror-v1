/*
 * Copyright (C) 2010 eXo Platform SAS.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Tokenizer for Groovy code */

var tokenizeGroovy = (function() {
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

  // A map of Groovy's keywords. The a/b/c keyword distinction is
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
	keywordsList['javaKeywordC'] = new Array('break', 'continue', 'extends', 'implements', 'import', 'new', 'package', 'return', 'super', 'this', 'throws');

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
	keywordsList['javaModifier'] = new Array('abstract', 'final', 'native', 'private', 'protected', 'public', 'static', 'strictfp', 'synchronized', 'transient', 'volatile');

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

	// ------------------- groovy keywords
	var keywordsList = {};

	// GJDK methods
	keywordsList['groovyGsdkMethod'] = new Array('abs','any','append','asList','asWritable','collect','compareTo','count','div','dump','each','eachByte','eachFile','eachLine','every','find','findAll','getAt','getErr','getIn','getOut','getText','grep','inject','inspect','intersect','isCase','join','leftShift','minus','multiply','mixin','newInputStream','newOutputStream','newPrintWriter','newReader','newWriter','next','plus','pop','power','previous','print','println','push','putAt','readBytes','readLines','reverse','reverseEach','round','size','sort','splitEachLine','step','subMap','times','toInteger','toList','tokenize','upto','waitForOrKill','withPrintWriter','withReader','withStream','withWriterAppend','write','writeLine');
	for (var i = 0; i < keywordsList['groovyGsdkMethod'].length; i++) {
		allKeywords[keywordsList['groovyGsdkMethod'][i]] = result("groovyGsdkMethod", "groovyGsdkMethod");
	}

    // keywords that optionally take an expression, and form a statement (return)
	keywordsList['groovyKeywordC'] = new Array('assert', 'property');
	for (var i = 0; i < keywordsList['groovyKeywordC'].length; i++) {
		allKeywords[keywordsList['groovyKeywordC'][i]] = result("groovyKeywordC", "groovyKeyword");
	}
	
	// other groovy keywords
	allKeywords = objectConcat(allKeywords, {
		"as": result("operator", "groovyKeyword"),
		"in": result("operator", "groovyKeyword"),
		"def": result("function", "groovyKeyword")
	});

    return allKeywords;
  }();

  // Some helper regexp matchers.
  var isOperatorChar = matcher(/[+\-*&%\/=<>!?|]/);
  var isDigit = matcher(/[0-9]/);
  var isHexDigit = matcher(/[0-9A-Fa-f]/);
  var isWordChar = matcher(/[\w\$_]/);

  // Wrapper around groovyToken that helps maintain parser state (whether
  // we are inside of a multi-line comment and whether the next token
  // could be a regular expression).
  function groovyTokenState(inside, regexp) {
    return function(source, setState) {
      var newInside = inside;
      var type = groovyToken(inside, regexp, source, function(c) {newInside = c;});
      var newRegexp = type.type == "operator" || type.type == "javaKeywordC" || type.type == "groovyKeywordC" || type.type.match(/^[\[{}\(,;:]$/);
      if (newRegexp != regexp || newInside != inside)
        setState(groovyTokenState(newInside, newRegexp));
      return type;
    };
  }

  // The token reader, inteded to be used by the tokenizer from
  // tokenize.js (through groovyTokenState). Advances the source stream
  // over a token, and returns an object containing the type and style
  // of that token.
  function groovyToken(inside, regexp, source, setInside) {
    function readHexNumber(){
      source.next(); // skip the 'x'
      source.nextWhile(isHexDigit);
      return {type: "number", style: "groovyNumber"};
    }

    function readNumber() {
      source.nextWhile(isDigit);
      if (source.equals(".")){
        source.next();
        source.nextWhile(isDigit);
      }
      if (source.equals("e") || source.equals("E")){
        source.next();
        if (source.equals("-"))
          source.next();
        source.nextWhile(isDigit);
      }
      return {type: "number", style: "groovyNumber"};
    }
    // Read a word, look it up in keywords. If not found, it is a
    // variable, otherwise it is a keyword of the type found.
    function readWord() {
      source.nextWhile(isWordChar);
      var word = source.get();
      var known = keywords.hasOwnProperty(word) && keywords.propertyIsEnumerable(word) && keywords[word];
      return known ? {type: known.type, style: known.style, content: word} :
      {type: "variable", style: "groovyVariable", content: word};
    }
    function readRegexp() {
      nextUntilUnescaped(source, "~/");
      source.nextWhile(matcher(/[gi]/));
      return {type: "regexp", style: "groovyRegexp"};
    }
    // Mutli-line comments are tricky. We want to return the newlines
    // embedded in them as regular newline tokens, and then continue
    // returning a comment token for every line of the comment. So
    // some state has to be saved (inside) to indicate whether we are
    // inside a /* */ sequence.
    function readMultilineComment(start){
      var newInside = "/*";
      var maybeEnd = (start == "*");
      while (true) {
        if (source.endOfLine())
          break;
        var next = source.next();
        if (next == "/" && maybeEnd){
          newInside = null;
          break;
        }
        maybeEnd = (next == "*");
      }
      setInside(newInside);
      return {type: "comment", style: "groovyComment"};
    }
    function readOperator() {
      source.nextWhile(isOperatorChar);
      return {type: "operator", style: "groovyOperator"};
    }
    function readString(quote) {
      var endBackSlash = nextUntilUnescaped(source, quote);
      setInside(endBackSlash ? quote : null);
      return {type: "string", style: "groovyString"};
    }

    // Fetch the next token. Dispatches on first character in the
    // stream, or first two characters when the first is a slash.
    if (inside == "\"" || inside == "'")
      return readString(inside);
    var ch = source.next();
    if (inside == "/*")
      return readMultilineComment(ch);
    else if (ch == "\"" || ch == "'")
      return readString(ch);
    // with punctuation, the type of the token is the symbol itself
    else if (/[\[\]{}\(\),;\:\.]/.test(ch))
      return {type: ch, style: "groovyPunctuation"};
    else if (ch == "0" && (source.equals("x") || source.equals("X")))
      return readHexNumber();
    else if (isDigit(ch))
      return readNumber();
    else if (ch == "/"){
      if (source.equals("*"))
      { source.next(); return readMultilineComment(ch); }
      else if (source.equals("/"))
      { nextUntilUnescaped(source, null); return {type: "comment", style: "groovyComment"};}
      else
        return readOperator();
    }
    else if (inside == "~/" && regexp)
        return readRegexp();
    else if (isOperatorChar(ch))
      return readOperator();
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
    return tokenizer(source, startState || groovyTokenState(false, true));
  };
})();
