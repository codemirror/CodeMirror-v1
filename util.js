function isString(x){return typeof(x) == "string";}

registerIteratorFactory("string", isString, function (string){
  var pos = 0;
  return {next: function() {
    if (pos < string.length) return string.charAt(pos++);
    else throw StopIteration;
  }};
});

function tryNext(iter, alternative){
  try {
    return iter.next();
  }
  catch (e) {
    if (e != StopIteration)
      throw e;
    else if (alternative)
      return alternative();
  }
}

function iconcat(iterators){
  var current = iter([]);
  function next(){
    return tryNext(current, function(){
      current = iter(iterators.next());
      return next();
    });
  }
  return {next: next};
}

function constantly(value){
  return function(){return value;}
}

function peekIter(iter, eofMarker){
  var peeked = false, peekValue = null;
  return {
    peek: function(){
      if (!peeked){
        peeked = true;
        peekValue = tryNext(iter, constantly(eofMarker));
      }
      return peekValue;
    },
    next: function(){
      if (peeked){
        if (peekValue === eofMarker)
          throw StopIteration;
        peeked = false;
        return peekValue;
      }
      else{
        return iter.next();
      }
    }
  };
}

function splitBy(func, iterator){
  iterator = iter(iterator);
  var done = false;
  function next(){
    if (done)
      throw StopIteration;
    var elements = [];
    while (!done){
      try {
        var next = iterator.next();
        if (func(next))
          break;
        else
          elements.push(next);
      } catch (e) {
        if (e != StopIteration || elements.length == 0)
          throw e;
        done = true;
      }
    }
    return elements;
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

function insertAfter(position, newnode){
  if (position.nextSibling)
    position.parentNode.insertBefore(newnode, position.nextSibling);
  else
    position.parentNode.appendChild(newnode);
}
function replaceNode(oldnode, newnode){
  oldnode.parentNode.replaceChild(newnode, oldnode);
}
