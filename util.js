function isString(x){return typeof(x) == "string";}

registerIteratorFactory("string", isString, function (string){
  var pos = 0;
  return {next: function() {
    if (pos < string.length) return string.charAt(pos++);
    else throw StopIteration;
  }};
});

function nextOr(iter, alternative){
  try {
    return iter.next();
  }
  catch (e) {
    if (e != StopIteration)
      throw e;
    else return alternative;
  }
}

function tryNext(iter, regular, alternative){
  try {
    return regular(iter.next());
  }
  catch (e) {
    if (e != StopIteration)
      throw e;
    else if (alternative)
      return alternative();
  }
}

function constantly(value){
  return function(){return value;}
}

function iconcat(iterators){
  var current = iter([]);
  function next(){
    return tryNext(
      current,
      operator.identity,
      function(){
        current = iter(iterators.next());
        return next();
      });
  }
  return {next: next};
}

function setObject(){
  var obj = {};
  forEach(arguments, function(value){
    obj[value] = true;
  });
  return obj;
}

function matcher(regexp){
  return function(value){return regexp.test(value);};
}

function stringCombiner(source){
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

function hasClass(element, className){
  var classes = element.className;
  return classes && new RegExp("(^| )" + className + "($| )").test(classes);
}

// Selection

var getSelection = document.selection ?
  function (window){
    var selection = window.document.selection.createRange();
    var start = selection.duplicate(), end = selection.duplicate();
    start.collapse(true);
    end.collapse(false);
    var startElement = start.parentElement();
    var endElement = end.parentElement();
    if (!endElement || !startElement)
      return null;

    start.moveToElementText(startElement);
    start.setEndPoint("EndToStart", selection);
    end.moveToElementText(endElement);
    end.setEndPoint("EndToEnd", selection);
    return {startElement: startElement, startPos: start.text.length,
            endElement: endElement, endPos: end.text.length};
  } :
  function (window){
    var selection = window.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;
    selection = selection.getRangeAt(0);
    return {startElement: selection.startContainer, startPos: selection.startOffset,
            endElement: selection.endContainer, endPos: selection.endOffset};
  };

var setSelection = document.selection ?
  function (window, selection) {
    var range = window.document.body.createTextRange(), dummy = range.duplicate();
    dummy.moveToElementText(selection.endElement);
    dummy.collapse(true);
    dummy.moveEnd("character", selection.endPos);
    range.moveToElementText(selection.startElement);
    range.setEndPoint("EndToEnd", dummy)
    range.moveStart("character", selection.startPos);
    range.select();
  } :
  function (window, selection) {
    var range = window.document.createRange();
    range.setStart(selection.startElement, selection.startPos);
    range.setEnd(selection.endElement, selection.endPos);
    var selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
  };
