// Selection

if (document.selection) {
  var markSelection = function (win) {
    var selection = win.document.selection;
    var rects = selection.createRange().getClientRects();
    var start = rects[0], end = rects[rects.length - 1];
    return {start: {x: start.left, y: start.top},
            end: {x: end.right, y: end.top},
            window: win};
  };

  var selectMarked = function(sel) {
    if (!sel)
      return;
    var range1 = sel.window.document.body.createTextRange(), range2 = range1.duplicate();
    range1.moveToPoint(sel.start.x, sel.start.y);
    range2.moveToPoint(sel.end.x, sel.end.y);
    range1.setEndPoint("EndToStart", range2);
    range1.select();
  };

  var replaceSelection = function(){};

  var cursorPos = function(win) {
    var selected = win.document.selection.createRange();
    selected.collapse(false);
    return selected.parentElement();
  };
}
else {
  var markSelection = function (win) {
    var selection = win.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;
    var range = selection.getRangeAt(0);

    var result = {start: {node: range.startContainer, offset: range.startOffset},
      end: {node: range.endContainer, offset: range.endOffset},
      window: win};
    
    function normalize(point){
      while (point.node.nodeType != 3 && point.node.nodeName != "BR") {
        var newNode = point.node.childNodes[point.offset] || point.node.nextSibling;
        point.offset = 0;
        while (!newNode && point.node.parentNode) {
          point.node = point.node.parentNode;
          newNode = point.node.nextSibling;
        }
        point.node = newNode;
      }
    }
    
    normalize(result.start);
    normalize(result.end);
    if (result.start.node)
      result.start.node.selectStart = result.start;
    if (result.end.node)
      result.end.node.selectEnd = result.end;

    return result;
  };

  var selectMarked = function (sel) {
    if (!sel)
      return;
    var win = sel.window;
    var range = win.document.createRange();

    function setPoint(point, which) {
      if (point.node) {
        delete point.node["select" + which];
        if (point.offset == 0)
          range["set" + which + "Before"](point.node);
        else
          range["set" + which](point.node, point.offset);
      }
      else {
        range.setStartAfter(win.document.body);
      }
    }

    setPoint(sel.start, "Start");
    setPoint(sel.end, "End");

    var selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  var replaceSelection = function(oldNode, newNode, length) {
    function replace(which) {
      var selObj = oldNode["select" + which];
      if (selObj) {
        if (selObj.offset > length) {
          selObj.offset -= length;
        }
        else {
          newNode["select" + which] = selObj;
          delete oldNode["select" + which];
          selObj.node = newNode;
        }
      }
    }
    replace("Start");
    replace("End");
  };

  var cursorPos = function(win) {
    var selection = win.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;
    var range = selection.getRangeAt(0);
    if (range.endContainer.nodeType == 3)
      return range.endContainer;
    else
      return range.endContainer.childNodes[range.endOffset];
  };
}
