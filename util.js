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

function constantly(value){
  return function(){return value;}
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

function hasClass(element, className){
  var classes = element.className;
  return classes && new RegExp("(^| )" + className + "($| )").test(classes);
}

function member(array, value) {
  for (var i = 0; i < array.length; i++){
    if (array[i] == value)
      return true;
  }
  return false;
}

function copyArray(array) {
  var newArr = new Array(array.length);
  for (var i = 0; i != array.length; i++)
    newArr[i] = array[i];
  return newArr;
}

function repeatString(str, times) {
  var result = [];
  while(times--) result.push(str);
  return result.join("");
}

function insertAfter(newNode, oldNode) {
  var parent = oldNode.parentNode;
  var next = oldNode.nextSibling;
  if (next)
    parent.insertBefore(newNode, next);
  else
    parent.appendChild(newNode);
  return newNode;
}

function insertAtStart(node, container) {
  if (container.firstChild)
    container.insertBefore(node, container.firstChild);
  else
    container.appendChild(node);
  return node;
}

function isAncestor(node, child) {
  while (child = child.parentNode) {
    if (node == child)
      return true;
  }
  return false;
}
