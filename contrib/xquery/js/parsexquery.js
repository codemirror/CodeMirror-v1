
var XqueryParser = Editor.Parser = (function(){
    function xqueryLexical(startColumn, currentToken, align, previousToken, encloseLevel){
        // column at which this scope was opened
        this.startColumn = startColumn;
        // type of scope ('stat' (statement), 'form' (special form), '[', '{', or
        // '(')
        this.currentToken = currentToken;
        // '[', '{', or '(' blocks that have any text after their opening
        // character are said to be 'aligned' -- any lines below are
        // indented all the way to the opening character.
        if (align != null) 
            this.align = align;
        // Parent scope, if any.
        this.previousToken = previousToken;
        this.encloseLevel = encloseLevel;
    }
    
    // Xquery indentation rules.
    function indentXquery(lexical){
        return function(firstChars, curIndent, direction){
            // test if this is next row after the open brace
            if (lexical.encloseLevel !== 0 && firstChars === "}") {
                return lexical.startColumn - indentUnit;
            }
            
            return lexical.startColumn;
        };
    }
    
    function parseXquery(source){
        var tokens = tokenizeXquery(source);
        
        var column = 0; // tells the first non-whitespace symbol from the
        // start of row.
        var previousToken = null;
        var previousTokens = [];  //mb
        var align = false; // tells if the text after the open brace
        var encloseLevel = 0; // tells curent opened braces quantity
        
        var cc = [statements];
        var consume, marked;
        
        var iter = {
            next: function(){
                var token = tokens.next();
                
                // since attribute and elements can be named the same, assume the
                // following word of each is a variable
                if(previousToken &&  ( previousToken.content == "attribute" || previousToken.content == "element")) {
                    token.type="variable";
                    token.style="xqueryVariable";
                }
                
                // if(token.content == "(" && previousToken.content == "node") {
                //     token.style="xqueryType";
                // }               
                // if(token.content == ")" && previousToken.content == "(" && previousTokens[previousTokens.length-2].content =="node") {
                //     token.style="xqueryType";
                // }        
                if(previousTokens.length > 3 && token.type == "word" &&
                    (previousTokens[previousTokens.length-3].style == "xml-attribute" || previousToken.type == "xml-tag-open") && 
                    token.content != ">") {
                    console.debug("token.content = " + token.content);
                    console.debug("previousTokens[previousTokens.length-3].style =" + previousTokens[previousTokens.length-3].style);
                    console.debug("previousToken.type = " + previousToken.type);
                    
                    token.style="xml-attribute";
                }       
                                
                
                if (token.type == "whitespace") {
                    if (token.value == "\n") { // test if this is end of line
                        if (previousToken !== null) {
                            if (previousToken.type === "{") { // test if there is open brace at the end of line
                                align = true;
                                column += indentUnit;
                                encloseLevel++;
                            }
                            else 
                                if (previousToken.type === "}") { // test if there is close brace at the end of line
                                    align = false;
                                    if (encloseLevel > 0) {
                                        encloseLevel--;
                                    }
                                    else {
                                        encloseLevel = 0;
                                    }
                                }
                            var lexical = new xqueryLexical(column, token, align, previousToken, encloseLevel);
                            token.indentation = indentXquery(lexical);
                        }
                    }
                    else 
                        column = token.value.length;
                }
                
                while(true) {
                  consume = marked = false;
                  // Take and execute the topmost action.
                  cc.pop()(token.type, token.content);
                  if (consume){
                    // Marked is used to change the style of the current token.
                    if (marked)
                      token.style = marked;
                    // Here we differentiate between local and global variables.
                    previousToken = token;
                    previousTokens[previousTokens.length] = token;
                    return token;
                  }
                }
                
                
            },
            
            copy: function(){
                var _cc = cc.concat([]), _tokenState = tokens.state, _column = column;

                return function copyParser(_source){
                  cc = _cc.concat([]); 
                  column = indented = _column;
                  tokens = tokenizeXquery(_source, _tokenState);
                  return iter;
                };
                
            },
            
        };

        function statements(type){
          return pass(statement, statements);
        }
        
        function statement(type){
            // if(type == "attribute")
            // if(window.console) console.debug(type);
            // 
            // if (type == "{") cont(pushlex("}"), block, poplex);
            // else cont();
            cont();
            /*                
            if (type == "var") cont(pushlex("vardef"), vardef1, expect(";"), poplex);
            else if (type == "keyword a") cont(pushlex("form"), expression, statement, poplex);
            else if (type == "keyword b") cont(pushlex("form"), statement, poplex);
            else if (type == "{") cont(pushlex("}"), block, poplex);
            else if (type == ";") cont();
            else if (type == "function") cont(functiondef);
            else if (type == "for") cont(pushlex("form"), expect("("), pushlex(")"), forspec1, expect(")"), poplex, statement, poplex);
            else if (type == "variable") cont(pushlex("stat"), maybelabel);
            else if (type == "switch") cont(pushlex("form"), expression, pushlex("}", "switch"), expect("{"), block, poplex, poplex);
            else if (type == "case") cont(expression, expect(":"));
            else if (type == "default") cont(expect(":"));
            else if (type == "catch") cont(pushlex("form"), pushcontext, expect("("), funarg, expect(")"), statement, poplex, popcontext);
            else pass(pushlex("stat"), expression, expect(";"), poplex);
            */
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

        // Push a new lexical context of the given type.
        function pushlex(type, info) {
          var result = function(){
            lexical = new xqueryLexical(column, type, align, previousToken, encloseLevel); //xqueryLexical(indented, column, type, null, lexical, info)
          };
          result.lex = true;
          
          return result;
        }
        // Pop off the current lexical context.
        function poplex(){
          lexical = lexical.previousToken;
        }
        poplex.lex = true;
        // The 'lex' flag on these actions is used by the 'next' function
        // to know they can (and have to) be ran before moving on to the
        // next token.

        // Look for statements until a closing brace is found.
        function block(type){
          if (type == "}") cont();
          else pass(statement, block);
        }
        
        function commasep(what, end){
          function proceed(type) {
            if (type == ",") cont(what, proceed);
            else if (type == end) cont();
            else cont(expect(end));
          }
          return function commaSeparated(type) {
            if (type == end) cont();
            else pass(what, proceed);
          };
        }
        
        function getPreview(numberFromCurrent) {
            var l = previousTokens.length;
            if(l - numberFromCurrent >= 0 )
                return previousTokens[l - numberFromCurrent];
            else previousTokens[0];
        }

        return iter;
        
        
    }
    return {
        make: parseXquery
    };
})();