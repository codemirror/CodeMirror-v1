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
