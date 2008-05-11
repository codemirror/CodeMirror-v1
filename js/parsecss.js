/* Simple parser for CSS */

Editor.Parser = (function() {
  var tokenizeCSS = (function() {
    function normal(source, setState) {
      var ch = source.next();
      if (ch == "@") {
        source.nextWhile(matcher(/\w/));
        return "at";
      }
      else if (ch == "/" && source.equals("*")) {
        setState(inCComment);
        return null;
      }
      else if (ch == "<" && source.equals("!")) {
        setState(inSGMLComment);
        return null;
      }
      else if (ch == "=") {
        return "compare";
      }
      else if (source.equals("=") && (ch == "~" || ch == "|")) {
        source.next();
        return "compare";
      }
      else if (ch == "\"" || ch == "'") {
        setState(inString(ch));
        return null;
      }
      else if (ch == "#") {
        source.nextWhile(matcher(/\w/));
        return "hash";
      }
      else if (ch == "!") {
        source.nextWhile(matcher(/[ \t]/));
        source.nextWhile(matcher(/\w/));
        return "important";
      }
      else if (/\d/.test(ch)) {
        source.nextWhile(matcher(/[\w.%]/));
        return "unit";
      }
      else if (/[,.+>*\/]/.test(ch)) {
        return "select-op";
      }
      else if (/[;{}:\[\]]/.test(ch)) {
        return "punctuation";
      }
      else {
        source.nextWhile(matcher(/[\w\\\-_]/));
        return "identifier";
      }
    }

    function inCComment(source, setState) {
      var maybeEnd = false;
      while (!source.endOfLine()) {
        var ch = source.next();
        if (maybeEnd && ch == "/") {
          setState(normal);
          break;
        }
        maybeEnd = (ch == "*");
      }
      return "comment";
    }

    function inSGMLComment(source, setState) {
      var dashes = 0;
      while (!source.endOfLine()) {
        var ch = source.next();
        if (dashes >= 2 && ch == ">") {
          setState(normal);
          break;
        }
        dashes = (ch == "-") ? dashes + 1 : 0;
      }
      return "comment";
    }

    function inString(quote) {
      return function(source, setState) {
        var escaped = false;
        while (!source.endOfLine()) {
          var ch = source.next();
          if (ch == quote && !escaped)
            break;
          escaped = ch == "\\";
        }
        if (!escaped)
          setState(normal);
        return "string";
      };
    }

    return function(source, startState) {
      return tokenizer(source, startState || normal);
    };
  })();

  function indentCSS(inBraces, inRule) {
    return function(nextChars) {
      if (!inBraces || /^\}/.test(nextChars)) return 0;
      else if (inRule) return 4;
      else return 2;
    };
  }

  // This is a very simplistic parser -- since CSS does not really
  // nest, it works acceptably well, but some nicer colouroing could
  // be provided with a more complicated parser.
  function parseCSS(source) {
    var tokens = tokenizeCSS(source);
    var inBraces = false, inRule = false;

    var iter = {
      next: function() {
        var token = tokens.next(), style = token.style, content = token.content;

        if (style == "identifier" && inRule)
          token.style = "value";
        if (style == "hash")
          token.style =  inRule ? "colorcode" : "identifier";

        if (content == "\n")
          token.indentation = indentCSS(inBraces, inRule);

        if (content == "{")
          inBraces = true;
        else if (content == "}")
          inBraces = false;
        else if (inBraces && content == ";")
          inRule = false;
        else if (inBraces && style != "comment" && style != "whitespace")
          inRule = true;

        return token;
      },

      copy: function() {
        var _inBraces = inBraces, _inRule = inRule, _tokenState = tokens.state;
        return function(source) {
          tokens = tokenizeCSS(source, _tokenState);
          inBraces = _inBraces;
          inRule = _inRule;
          return iter;
        };
      }
    };
    return iter;
  }

  return {make: parseCSS, electricChars: "}"};
})();
