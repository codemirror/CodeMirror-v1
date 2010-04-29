/*
 * Copyright (C) 2010 eXo Platform SAS.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Parse function for Groovy. Makes use of the tokenizer from
 * tokenizegroovy.js. Note that your parsers do not have to be
 * this complicated -- if you don't want to recognize local variables,
 * in many languages it is enough to just look for braces, semicolons,
 * parentheses, etc, and know when you are inside a string or comment.
 *
 * See manual.html for more info about the parser interface.
 */

var GroovyParser = Editor.Parser = (function(){
    function GroovyLexical(startColumn, currentToken, align, previousToken, encloseLevel){
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
    // Groovy indentation rules.
    function indentGroovy(lexical){
        return function(firstChars, curIndent, direction){
            // test if this is next row after the open brace
            if (lexical.encloseLevel !== 0 && firstChars === "}") {
                return lexical.startColumn - indentUnit;
            }
            
            return lexical.startColumn;
        };
    }
    
    function parseGroovy(source){
        source = tokenizeGroovy(source);
        
        var column = 0; // tells the first non-whitespace symbol from the
        // start of row.
        var previousToken = null;
        var align = false; // tells if the text after the open brace
        var encloseLevel = 0; // tells curent opened braces quantity
        var iter = {
            next: function(){
                var token = source.next();
                
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
                            var lexical = new GroovyLexical(column, token, align, previousToken, encloseLevel);
                            token.indentation = indentGroovy(lexical);
                        }
                    }
                    else 
                        column = token.value.length;
                }
                
                previousToken = token;
                return token;
            },
            
            copy: function(){
                var _column = column;
                return function(_source){
                    column = indented = _column;
                    source = tokenizeGroovy(_source);
                    return iter;
                };
            }
        };
        return iter;
    }
    return {
        make: parseGroovy
    };
})();