var HTMLMixedParser = Editor.Parser = (function() {
  if (!(CSSParser && JSParser && XMLParser))
    throw new Error("CSS, JS, and XML parsers must be loaded for HTML mixed mode to work.");
  XMLParser.configure({useHTMLKludges: true});

  function stringAhead(stream, string) {
    function matchString() {
      for (var i = 0; i < string.length; i++) {
        var ch = stream.peek();
        if (!ch || string.charAt(i) != ch.toLowerCase()) return false;
        stream.next();
      }
      return true;
    }

    stream.nextWhile(matcher(/[\s\u00a0]/));
    var found =  matchString();
    stream.reset();
    return found;
  }

  function parseMixed(stream) {
    var htmlParser = XMLParser.make(stream), localParser = null, inTag = false;
    var iter = {next: top, copy: copy};

    function top() {
      var token = htmlParser.next();
      if (token.content == "<")
        inTag = true;
      else if (token.style == "tagname" && inTag === true)
        inTag = token.content.toLowerCase();
      else if (token.content == ">") {
        if (inTag == "script")
          iter.next = local(JSParser, "</script");
        else if (inTag == "style")
          iter.next = local(CSSParser, "</style");
        inTag = false;
      }
      return token;
    }
    function local(parser, tag) {
      localParser = parser.make(stream, htmlParser.indentation() + 2);
      return function() {
        if (stringAhead(stream, tag)) {
          localParser = null;
          iter.next = top;
          return top();
        }
        return localParser.next();
      };
    }

    function copy() {
      var _html = htmlParser.copy(), _local = localParser && localParser.copy(),
          _next = iter.next, _inTag = inTag;
      return function(_stream) {
        stream = _stream;
        htmlParser = _html(_stream);
        localParser = _local && _local(_stream);
        iter.next = _next;
        inTag = _inTag;
        return iter;
      };
    }
    return iter;
  }

  return {make: parseMixed, electricChars: "{}/"};
})();
