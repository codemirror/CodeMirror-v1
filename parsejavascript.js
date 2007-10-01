var parseJavaScript = function() {
  var atomicTypes = setObject("atom", "number", "variable", "string", "regexp");  

  function JSLexical(indented, column, type, align, prev) {
    this.indented = indented;
    this.column = column;
    this.type = type;
    if (align != null)
      this.align = align;
    this.prev = prev;
  }
  JSLexical.prototype.indentation = function(firstChar) {
    var closing = firstChar == this.type;
    if (this.type == "vardef")
      return this.indented + 4;
    if (this.type == "stat")
      return this.indented + 2;
    else if (this.align)
      return this.column - (closing ? 1 : 0);
    else
      return this.indented + (closing ? 0 : 2);
  }

  return function(input){
    var tokens = tokenizeJavaScript(input)
    var cc = [statements];
    var consume, marked;
    var context = null;
    var lexical = new JSLexical(-2, 0, "block", false);
    var column = 0;
    var indented = 0;
  
    var parser = {next: next, copy: copy};
  
    function next(){
      while(cc[cc.length - 1].lex)
        cc.pop()();
  
      var token = tokens.next();
      if (token.type == "whitespace" && column == 0)
        indented = token.value.length;
      column += token.value.length;
      if (token.type == "newline"){
        indented = column = 0;
        if (!("align" in lexical))
          lexical.align = false;
        token.lexicalContext = lexical;
      }
      if (token.type == "whitespace" || token.type == "newline" || token.type == "comment")
        return token;
      if (!("align" in lexical))
        lexical.align = true;
  
      while(true){
        consume = marked = false;
        cc.pop()(token.type, token.name);
        if (consume){
          if (marked)
            token.style = marked;
          else if (token.type == "variable" && inScope(token.name))
            token.style = "localvariable";
          return token;
        }
      }
    }
    function copy(){
      var _context = context, _lexical = lexical, _cc = cc.concat([]), _regexp = tokens.regexp, _comment = tokens.inComment;
  
      return function(input){
        context = _context;
        lexical = _lexical;
        cc = _cc.concat([]); // copies the array
        column = indented = 0;
        tokens = tokenizeJavaScript(input);
        tokens.regexp = _regexp;
        tokens.inComment = _comment;
        return parser;
      };
    }
  
    function push(fs){
      for (var i = fs.length - 1; i >= 0; i--)
        cc.push(fs[i]);
    }
    function cont(){
      push(arguments);
      consume = true;
    }
    function pass(){
      push(arguments);
      consume = false;
    }
    function mark(style){
      marked = style;
    }
  
    function pushcontext(){
      context = {prev: context, vars: {"this": true, "arguments": true}};
    }
    function popcontext(){
      context = context.prev;
    }
    function register(varname){
      if (context){
        mark("variabledef");
        context.vars[varname] = true;
      }
    }
    function inScope(varname){
      var cursor = context;
      while (cursor) {
        if (cursor.vars[varname])
          return true;
        cursor = cursor.prev;
      }
      return false;
    }
  
    function pushlex(type){
      var result = function(){
        lexical = new JSLexical(indented, column, type, null, lexical)
      };
      result.lex = true;
      return result;
    }
    function poplex(){
      lexical = lexical.prev;
    }
    poplex.lex = true;
  
    function expect(wanted){
      return function(type){
        if (type == wanted) cont();
        else cont(arguments.callee);
      };
    }
  
    function statements(type){
      return pass(statement, statements);
    }
    function statement(type){
      if (type == "var") cont(pushlex("vardef"), vardef1, expect(";"), poplex);
      else if (type == "keyword a") cont(pushlex("stat"), expression, statement, poplex);
      else if (type == "keyword b") cont(pushlex("stat"), statement, poplex);
      else if (type == "{") cont(pushlex("}"), block, poplex);
      else if (type == "function") cont(functiondef);
      else if (type == "for") cont(pushlex("stat"), expect("("), pushlex(")"), forspec1, expect(")"), poplex, statement, poplex);
      else if (type == "case") cont(expression, expect(":"));
      else if (type == "variable") cont(pushlex("stat"), maybelabel);
      else if (type == "catch") cont(pushlex("stat"), pushcontext, expect("("), funarg, expect(")"), statement, poplex, popcontext);
      else pass(pushlex("stat"), expression, expect(";"), poplex);
    }
    function expression(type){
      if (atomicTypes.hasOwnProperty(type)) cont(maybeoperator);
      else if (type == "function") cont(functiondef);
      else if (type == "keyword c") cont(expression);
      else if (type == "(") cont(pushlex(")"), expression, expect(")"), poplex);
      else if (type == "operator") cont(expression);
      else if (type == "[") cont(pushlex("]"), commasep(expression), expect("]"), poplex);
      else if (type == "{") cont(pushlex("}"), commasep(objprop), expect("}"), poplex);
    }
    function maybeoperator(type){
      if (type == "operator") cont(expression);
      else if (type == "(") cont(pushlex(")"), expression, commasep(expression), expect(")"), poplex);
      else if (type == ".") cont(property, maybeoperator);
      else if (type == "[") cont(pushlex("]"), expression, expect("]"), poplex);
    }
    function maybelabel(type){
      if (type == ":") cont(poplex, statement);
      else pass(maybeoperator, expect(";"), poplex);
    }
    function property(type){
      if (type == "variable") {mark("property"); cont();}
    }
    function objprop(type){
      if (type == "variable") mark("property");
      if (atomicTypes.hasOwnProperty(type)) cont(expect(":"), expression);
    }
    function commasep(what){
      function proceed(type) {
        if (type == ",") cont(what, proceed);
      };
      return function() {
        pass(what, proceed);
      };
    }
    function block(type){
      if (type == "}") cont();
      else pass(statement, block);
    }
    function vardef1(type, value){
      if (type == "variable"){register(value); cont(vardef2);}
      else cont();
    }
    function vardef2(type){
      if (type == "operator") cont(expression, vardef2);
      else if (type == ",") cont(vardef1);
    }
    function forspec1(type, value){
      if (type == "var") cont(vardef1, forspec2);
      else cont(expression, forspec2);
    }
    function forspec2(type){
      if (type == ",") cont(forspec1);
      if (type == ";") cont(expression, expect(";"), expression);
    }
    function functiondef(type, value){
      if (type == "variable"){register(value); cont(functiondef);}
      else if (type == "(") cont(pushcontext, commasep(funarg), expect(")"), statement, popcontext);
    }
    function funarg(type, value){
      if (type == "variable"){register(value); cont();}
    }
  
    return parser;
  }
}();