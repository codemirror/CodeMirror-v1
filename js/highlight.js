// Minimal framing needed to use CodeMirror-style parsers to highlight
// code. Load this along with tokenize.js, stringstream.js, and your
// parser. Then call highlightText, passing a string, a dom node in
// which to append the tokens, and optionally (not needed if you only
// loaded one parser) a parser object.

// Stuff from util.js that the parsers are using.
var StopIteration = {toString: function() {return "StopIteration"}};
function matcher(regexp){
  return function(value){return regexp.test(value);};
}

var Editor = {};
var indentUnit = 2;

(function(){
  function normaliseString(string) {
    var tab = "";
    for (var i = 0; i < indentUnit; i++) tab += " ";

    string = string.replace(/\t/g, tab).replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
    var pos = 0, parts = [], lines = string.split("\n");
    for (var line = 0; line < lines.length; line++) {
      if (line != 0) parts.push("\n");
      parts.push(lines[line]);
    }

    return {
      next: function() {
        if (pos < parts.length) return parts[pos++];
        else throw StopIteration;
      }
    };
  }

  window.highlightText = function(string, output, parser) {
    var parser = (parser || Editor.Parser).make(stringStream(normaliseString(string)));
    try {
      while (true) {
        var token = parser.next();
        var span = document.createElement("SPAN");
        span.className = token.style;
        span.appendChild(document.createTextNode(token.value));
        output.appendChild(span);
      }
    }
    catch (e) {
      if (e != StopIteration) throw e;
    }
  }
})();
