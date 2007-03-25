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
