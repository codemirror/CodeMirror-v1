/* A few useful utility functions. */

// Create a predicate function that tests a string againsts a given
// regular expression.
function matcher(regexp){
  return function(value){return regexp.test(value);};
}

// Test whether a DOM node has a certain CSS class. Much faster than
// the MochiKit equivalent, for some reason.
function hasClass(element, className){
  var classes = element.className;
  return classes && new RegExp("(^| )" + className + "($| )").test(classes);
}

// Insert a DOM node after another node.
function insertAfter(newNode, oldNode) {
  var parent = oldNode.parentNode;
  var next = oldNode.nextSibling;
  if (next)
    parent.insertBefore(newNode, next);
  else
    parent.appendChild(newNode);
  return newNode;
}

// Insert a dom node at the start of a container.
function insertAtStart(node, container) {
  if (container.firstChild)
    container.insertBefore(node, container.firstChild);
  else
    container.appendChild(node);
  return node;
}

// Check whether a node is contained in another one.
function isAncestor(node, child) {
  while (child = child.parentNode) {
    if (node == child)
      return true;
  }
  return false;
}

// The non-breaking space character.
var nbsp = String.fromCharCode(160);
// Unfortunately, IE's regexp matcher thinks non-breaking spaces
// aren't whitespace.
var realWhiteSpace = new RegExp("^[\\s" + nbsp + "]*$");
