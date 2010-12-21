function module(f) {
  var exports = {};
  f(exports);
  var name = exports.getInfo().name;
  var rules = exports.getRules();
  function processRule(rule) {
    for (var i = 0; i < rule.length; i++) {
      var elt = rule[i], re = elt.regex;
      if (re && re.source.charAt(0) != "^") {
        var flags = (re.ignoreCase ? "i" : "") + (re.multiline ? "m" : "") + (re.global ? "g" : "");
        elt.regex = new RegExp("^" + re.source, flags);
      }
    }
  }
  for (var rule in rules)
    if (rules.hasOwnProperty(rule)) processRule(rules[rule]);
  Editor.Parser = window[name + "Parser"] = {
    make: function(stream){return portableParser(stream, rules);}
  };
}

function portableParser(stream, rules) {
  function whiteSpace(ch) {return ch != "\n" && /^[\s\u00a0]*$/.test(ch);}

  var iter = {next: next, copy: copy};
  var state = rules.start, startOfLine = true;
  function next() {
    if (!stream.more()) throw StopIteration;
    if (stream.equals("\n")) {
      stream.next();
      startOfLine = true;
      return {value: stream.get(), style: "whitespace"};
    }
    if (startOfLine && stream.applies(whiteSpace)) {
      stream.nextWhile(whiteSpace);
      return {value: stream.get(), style: "whitespace"};
    }
    startOfLine = false;
    for (var i = 0; i < state.length; i++) {
      var pat = state[i];
      if (stream.lookAheadRegex(pat.regex, true)) {
        if (pat.next) state = rules[pat.next];
        var text = stream.get(), name = pat.token;
        if (name.call) name = name(text);
        return {value: text, style: pat.token};
      }
    }
    stream.nextWhileMatches(/\S/);
    return {value: stream.get(), style: "error"};
  }
  function copy() {
    var _state = state;
    return function(_stream) {
      stream = _stream;
      state = _state;
      startOfLine = true;
    }
  }
  return iter;
}
