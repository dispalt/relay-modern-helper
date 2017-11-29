/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @providesModule RelayFlowGenerator
 * @flow
 * @format
 */

'use strict';

const t = require('babel-types');

const {
  FlattenTransform,
  IRVisitor,
  SchemaUtils,
} = require('relay-compiler/lib/GraphQLCompilerPublic');

const {
  transformScalarType,
  transformInputType,
} = require('./ScalaTypeTransformers');

import type {
  IRTransform,
  Fragment,
  Root,
  CompilerContext,
} from 'relay-compiler/lib/GraphQLCompilerPublic';

import type {
  ConcreteNode,
  ConcreteRoot,
  ConcreteFragment,
  ConcreteBatch,
  ConcreteSelection,
  ConcreteScalarField,
  ConcreteLinkedField,
  ConcreteFragmentSpread,
  ConcreteInlineFragment,
  ConcreteCondition,
  ConcreteDirective,
} from 'react-relay';

const {
  GraphQLEnumType,
  GraphQLInputType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLType,
  GraphQLUnionType,
  GraphQLSchema,
} = require('graphql');

import type {ScalarTypeMapping} from 'relay-compiler/lib/RelayFlowTypeTransformers';

const babelGenerator = require('babel-generator').default;

const {isAbstractType} = SchemaUtils;

const invariant = require('invariant');

const SJSTransform = require('../transforms/SJSTransform');

/*
Better typing ideas here.

https://github.com/facebook/relay/issues/1918

*/

function generate(
  node: Root | Fragment,
  customScalars?: ?ScalarTypeMapping,
  inputFieldWhiteList?: ?Array<string>,
  schema: GraphQLSchema,
  nodes: Array<Root | Fragment>,
): {core: string, supporting: string, implicits: string} {

  // const code = babelGenerator(ast).code;
  const newCT = new ClassTracker(nodes);
  try {
    const ast = IRVisitor.visit(
      node,
      createVisitor(newCT)
    )
    const code = newCT.out();    
    // console.log(result);
    return code;
  } catch(e) {
    console.error(e);
    throw e;
  }
}

type ASpread = {
  members: Array<Member>,
  extendCls: Array<string>,
}

type ATpe = {
  name: string,
  isArray?: boolean,
  isOptional?: boolean,
}

type Member = {
  name: string,
  tpe: Array<ATpe>,
  comments: Array<string>,
  node?: ?ConcreteNode,
  parentFrag?: ?string,
  scalar: boolean,
  or?: ?boolean,
};

type Cls = {
  name?: ?string,
  members: Array<Member>,
  extendsC: Array<string>,
  open: boolean,
  linkedField: boolean,
  children?: ?Map<string, Cls>,
};

type ImplDef = {
  from: string,
  to: string,
  name: string,
  inline: boolean,
}

class ClassTracker {
  
  classes: Map<string, Cls>;
  topClasses: Map<string, Cls>;
  implicits: Array<ImplDef>;
  fields: Array<Member>;
  spreads: Array<[string, ASpread]>;
  _nodes: Array<ConcreteRoot | ConcreteFragment>;
  _missingFrags: Array<string>;

  constructor(nodes: Array<ConcreteRoot | ConcreteFragment>) {
    this.classes = new Map();
    this.topClasses = new Map();
    this.fields = [];
    this.spreads = [];
    this._nodes = nodes;
    this._missingFrags = [];
    this.implicits = [];
  }

  newClassName(cn: string, n: ?number): string {
    const name = n ? `${cn}_${n}` :cn;
    const cls = this.classes.get(name);

    if (cls) {
      const num = n ? n + 1 : 1;
      return this.newClassName(cn, num);
    } else {
      return name;
    }
  }

  newImplicit(from: string, to: string, name: string, inline: boolean) {
    this.implicits.unshift({from, to, name, inline});
  }

  
  newClass(cn: string, members: Array<Member>, extendsC: Array<string>, linkedField: boolean): string {
    let name = cn;
    if (linkedField) {
      name = this.newClassName(cn);
      const cls = {
        name, 
        members,
        extendsC,
        linkedField,
        open: false,
      }
      this.classes.set(name, cls);
    } else {
      const cls = {
        name, 
        members,
        extendsC,
        linkedField,
        open: false,
      }
      this.topClasses.set(name, cls);
    }
    return name;
  }

  handleInline(node: ConcreteInlineFragment) {
    //$FlowFixMe
    const spreadFrags: Array<ConcreteFragmentSpread> = node.selections.filter(s => s.kind === "FragmentSpread");
    const selectionMembers = node.selections.filter(s => s.kind !== "FragmentSpread");
  }

  flattenMembers(members: Array<Member>, spreads: Array<[string, Array<Member>]>): Map<string, Array<Member>> {
    const m : Map<string, Array<Member>> = new Map();
    members.forEach(s => {
      const mem = m.get(s.name)
      m.set(s.name, mem ? mem.concat(s) : [s]);
    });

    for (const [key, value] of spreads) {
      value.forEach(s => {
        const mem = m.get(s.name)
        m.set(s.name, mem ? mem.concat(s) : [s]);
      });
    }
    return m;
  }

  getNewTpeInlineFrag(node: ConcreteInlineFragment): string {
    if (node.parentTpe) {
      return node.parentTpe.slice(1).join("") + node.typeCondition.toString();
    }
    throw new Error(`Shouldn't happen, ${node.typeCondition.toString} parent: ${node.parentTpe}`);
  }

  /**
   * Valid for any type.
   * @param {*} node 
   */
  getNewTpeParent(node: ConcreteLinkedField | ConcreteRoot | ConcreteFragment | ConcreteInlineFragment): string {
    if (node.parentTpe)
      return node.parentTpe.slice(1).join("");
    else 
      return node.parentTpe.join("");
  }

  getNewTpe(node: ConcreteLinkedField | ConcreteRoot | ConcreteFragment): string {
    if (node.kind == "LinkedField") {
      if (node.parentTpe) {
        return node.parentTpe.slice(1).join("") + titleCase(node.name);
      } 
    }
    return titleCase(node.name);
  }

  getNewTpeMember(node: ConcreteLinkedField | ConcreteRoot | ConcreteFragment): string {
    if (node.kind == "LinkedField" || node.kind === "InlineFragment") {
      if (node.parentTpe) {
        if (node.parentTpe.length == 1) {
          return node.parentTpe.join("") + titleCase(node.name)
        } else {
          return node.parentTpe.slice(1).join("") + titleCase(node.name);
        }
      } 
    }
    return titleCase(node.name);
  }

  /**
   * Handle inline frags. 
   */
  inlineFrag(node: ConcreteInlineFragment) {
    const newClassName: string = this.getNewTpeInlineFrag(node);
    const localMembers: Array<Member> = node.selections.map(foo => this.popMember());
    const selectionMembers = node.selections.filter(s => s.kind !== "FragmentSpread" && s.kind !== "InlineFragment"); 
    const newTpe = this.newClass(newClassName, localMembers, [], true);
    const parentCls = this.getNewTpeParent(node);
    this.newImplicit(parentCls, newTpe, `${node.typeCondition.toString()}`, true);
    node.selections;
  }

  closeField(node: ConcreteLinkedField | ConcreteRoot | ConcreteFragment, linked: boolean) {
    //$FlowFixMe
    const spreadFrags: Array<ConcreteFragmentSpread> = node.selections.filter(s => s.kind === "FragmentSpread");
    // $FlowFixMe
    const inlineFrags: Array<ConcreteInlineFragment> = node.selections.filter(s => s.kind === "InlineFragment");

    // Don't look at Inline Fragments or Fragment Spreads, they get treated differently.
    const selectionMembers = node.selections.filter(s => s.kind !== "FragmentSpread" && s.kind !== "InlineFragment");    
    // We modify this in the baton.  Pop all the members off.
    let localMembers: Array<Member> = selectionMembers.map(foo => this.popMember());

  
    if (inlineFrags.length > 0) {
      // if we don't have __typename in the set of selection members add it synthetically since the relay compiler will
      // anyways.
      if (!selectionMembers.find(f => f.name === "__typename"))
        localMembers.push({name: "__typename", tpe: [{name: "String"}], comments: [], scalar: true});
    }

    const listOfSpreads: Array<[string, ASpread]> = spreadFrags.map(_ => this.popSpread());
    const fieldExtend: Array<string> = [];// flattenArray(listOfSpreads.map(s => s[1].extendCls));

    // $FlowFixMe
    const fieldName: string = node.alias ? node.alias : node.name;
    const newClassName: string = this.getNewTpe(node);
    const scalar = false;


    // Create implicit conversions here.
    listOfSpreads.forEach(([k, {members}]) => {
      this.newImplicit(newClassName, k, k, false);
    });
  
    // Very simple case, we are sure it can combine.
    if (spreadFrags.length == 1 && selectionMembers.length == 0) {
      // Only FragmentSpreads and no conflicting members
      const newTpe = this.transformScalarType(node.type, spreadFrags[0].name);
      return this.newMember({
        name: fieldName,
        tpe: newTpe,
        comments: [`Combined the fields on a spread: ${spreadFrags[0].name}`],
        parentFrag: "",
        scalar,
      });
    } 
    
    
    if (spreadFrags.length > 0) {
      // Combine all the children both spreads and 
      const localSpreads = listOfSpreads.map(s => [s[0], s[1].members])
      const sumOfMembers: Map<string, Array<Member>> = this.flattenMembers(localMembers, localSpreads);      
      // console.log(JSON.stringify(sumOfMembers, null, 2));

      //TODO: This is like a shitty version of fold.
      localMembers = Array.from(sumOfMembers.entries()).map(s => {
        if (s[1].length == 1)
          return s[1][0];
        let m = s[1][0];
        s[1].slice(1).forEach(ss => {
          ss.comments.push(`Combining fields, with or? "${ss.or}" `)
          m = this.combineFields(m, ss);
        });
        return m;
      });
    }

    
    if (node.selections.length === selectionMembers.length) {
      // No spreads.
      const newTpe = this.newClass(newClassName, localMembers, fieldExtend, linked);
      const newNewTpe = this.transformScalarType(node.type, newTpe);
      this.newMember({
        name: fieldName,
        tpe: newNewTpe,
        comments: ["No spreads, just field combining."],
        scalar,
      });
    } else {
      // Spreads and members that are conflicting
      const newTpe = this.newClass(newClassName, localMembers, fieldExtend, linked);
      const newNewTpe = this.transformScalarType(node.type, newTpe);
      this.newMember({
        name: fieldName,
        tpe: newNewTpe,
        comments: ['New fields added, conflicts detected.'],
        scalar,
      });
    } 
  }

  hasAndStripSjsWithDirective(n: ConcreteFragmentSpread): boolean {
    // $FlowFixMe
    const hasD = n.directives.filter(s => s.name === "sjs" && s.args[0] && s.args[0].name == 'with' && s.args[0].value.value);
    n.directives = n.directives ? n.directives.filter(s => s.name !== "sjs") : [];
    return hasD.length > 0;
  }

  newSpread(n: ConcreteFragmentSpread) {
    // $FlowFixMe
    const tpe = this.getNewTpe(n);
    // console.log(JSON.stringify(n, null, 2));
    const hasD = n.metadata && n.metadata.with;

    const dm = this.getDirectMembersForFrag(n.name, tpe).map(s => {
      if (hasD) {
        s.or = false;
      } else {
        s.or = true;
      }
      return s;
    });
    this.spreads.unshift([n.name, {
      members: dm,
      extendCls: [],
    }]);
  }

  newMember(m: Member): void {
    this.fields.unshift(m);
  }

  popMember(): Member {
    return this.fields.shift();
  }

  popSpread(): [string, ASpread] {
    return this.spreads.shift();
  }

  memberCopy(): Array<Member> {
    return [].concat(this.fields);
  }

  mergeMemberTypes(m: Member): void {
    this.fields.forEach(mm => {
      // $FlowFixMe
      if (mm.name === m.name && mm.node && m.node && mm.node.type === m.node.type) {
        mm.tpe = mm.tpe.concat(m.tpe)
      }
    });
  }

  jsPrefix(): string {
    return "js";
  }

  anyType(): string {
    return `${this.jsPrefix()}.Any`;
  }

  anyObjType(): string {
    return `${this.jsPrefix()}.Dictionary[${this.jsPrefix()}.Any]`;
  }

  transformNonNullableScalarType(
    type: GraphQLType,
    backupType: ?string,
  ): Array<ATpe> {
    if (type instanceof GraphQLList) {
      // throw new Error(`Could not convert from GraphQL type ${type.toString()}`);
      return this.transformScalarType(type.ofType, backupType).map(s => {

        s.isArray = true;
        return s;
      });
    } else if (
      type instanceof GraphQLObjectType ||
      type instanceof GraphQLUnionType ||
      type instanceof GraphQLInterfaceType
    ) {
      // throw new Error(`Could not convert from GraphQL type ${type.toString()}`);
      if (!backupType) {
        throw new Error(`Could not convert from GraphQL type ${type.toString()}, missing backup type`);
      }
      return [{name: backupType}];
    } else if (type instanceof GraphQLScalarType) {
      return this.transformGraphQLScalarType(type, backupType);
    } else if (type instanceof GraphQLEnumType) {
      // TODO: String for now.
      return [{name: "String"}];
    } else {
      throw new Error(`Could not convert from GraphQL type ${type.toString()}`);
    }
  }

  transformGraphQLScalarType(type: GraphQLScalarType, backupType: ?string): Array<ATpe> {
    switch (type.name) {
      case 'ID':
      case 'String':
      case 'Url':
        return [{name: "String"}];
        
      case 'Float':
      case 'Int':
      case 'BigDecimal':
      case 'BigInt':
      case 'Long':
        return [{name: "Double"}];
      case 'Boolean':
        return [{name: "Boolean"}];
      default:
        if (backupType) {
          return [{name: backupType}];
        } 
        return [{name: `js.Any`}];
    }
  }

  transformScalarType(
    type: GraphQLType,
    backupType: ?string,
  ): Array<ATpe> {
    if (type instanceof GraphQLNonNull) {
      return this.transformNonNullableScalarType(type.ofType, backupType);
    } else {
      // $FlowFixMe
      return this.transformNonNullableScalarType(type, backupType);
    }
  }

  combineFields(m: Member, m2: Member): Member {
    invariant(m.name === m2.name, "Names need to match to combine.");
    const tpeMap: Map<string, Array<ATpe>> = new Map();
    [...m.tpe, ...m2.tpe].forEach(tpe => {

      const found = tpeMap.get(tpe.name)
      if (!found) {
        tpeMap.set(tpe.name, [tpe]);
      } else {
        if (!found.every(s => {
          return s.isArray == tpe.isArray && s.isOptional == tpe.isOptional && s.name === tpe.name;
        })) {
          found.push(tpe);
        }
      }
    });

    return {
      ...m,
      or: m.or || m2.or,
      name: m.name,
      tpe: flattenArray(Array.from(tpeMap.values())),
      comments: [...m.comments, ...m2.comments],
      scalar: m.scalar || m2.scalar,
    }
  }

  getDirectMembersForFrag(name: string, backupType: ?string): Array<Member> {
    const node = this._nodes.find(n => n.kind === "Fragment" && n.name === name);
    if (node) {
      let result =  flattenArray(node.selections.map(s => {
        
        if (s.kind == "FragmentSpread") {
          // console.log(s);
          // $FlowFixMe
          return this.getDirectMembersForFrag(s.name, name + "." + titleCase(s.name));
        } else {

          return [{
            // $FlowFixMe
            name: s.name,
            // $FlowFixMe
            tpe: this.transformScalarType(s.type, name + "." + titleCase(s.name)),
            comments: [`getDirectMembersForFrag child of ${name}`],
            parentFrag: name,
            scalar: s.kind == "ScalarField" ? true : false,
          }];
        }
      }))
      return result;
    } else return [];
  }

  outCls({name, members, extendsC, open}: Cls, otherClasses?: ?Map<string, Cls>): string {    
    invariant(name, "Name needs to be set");

    const ex = extendsC.length > 0 ? ["with", extendsC.join(" with ")] : [];
    const cls = ["trait", name, "extends", "js.Object", ...ex , "{"].join(" ");
    // TODO: Investigate why this member is not there, probably has to do with InlineFragments.
    const m = Array.from(members.values()).filter(s => !!s).map(s => {
      const comment = s.comments.length == 0 ? [] : ["  /**", ...s.comments, "*/", "\n"];

      // Figure out if we've created the type, if so, add a prefix.
      let tpe = "";
      const joinStr = s.or ? " | " : " with ";
      // console.log(JSON.stringify(s,null,2));
      if (otherClasses) {
        // Declared new classes.
        const cs = new Set(otherClasses.keys());
        tpe = s.tpe.map(s => {

          let newTpeName = cs.has(s.name) ? name + "." + s.name: s.name;
          if (s.isArray) {
            newTpeName = "js.Array[" + newTpeName + "]";
          }

          return newTpeName;
        }).join(joinStr);
      } else {
        tpe = s.tpe.map(s => {
          let newTpeName = s.name;
          if (s.isArray) {
            newTpeName = "js.Array[" + newTpeName + "]";
          }

          return newTpeName;
        }).join(joinStr);
      }

      return [comment.join(" "), "  val", s.name, ":", tpe].join(" ");
    }).join("\n");

    return [cls, m, "}"].join("\n");
  }

  /**
   * Group all the implicits, and create
   * @param {} impl 
   */
  outImplicitsFrags(impl: Array<ImplDef>): string {

    var groups: {[string]: Array<ImplDef>} = {};
    impl.forEach((item) => {
       var list = groups[item.from];
    
       if(list){
           list.push(item);
       } else{
          groups[item.from] = [item];
       }
    });

    return Object.keys(groups).map(k => {

      const items = groups[k]
      const members = Array.from(items).map(({from, to, name}) => {
        return [`  def as${name}: Option[${to}] = {`,
          `    if (f.__typename == "${name}") Some(f.asInstanceOf[${to}])`,
          `    else None`,
          '  }'
        ].join("\n  ");
      });
      return [`implicit class ${k}2Ops(f: ${k}) {`, ...members, `}`].join("\n  ");
    }).join("\n  ");

  }

  outImplicitsConversion(impl: Array<ImplDef>): string {
    const text = impl.map(({from, to, name}) => {
      return `implicit def ${from}2${to}(f: ${from}): ${to} = f.asInstanceOf[${to}]`;
    }).join("\n  ");
    return text;
  }

  out(): { supporting: string, core: string, implicits: string } {
    invariant(this.topClasses.size === 1, `there should be 1 "topClasses", got `);

    const supporting = Array.from(this.classes.entries())
      .map(s => s[1])
      .map(cls => {
        return this.outCls(cls);
      })
      .join("\n  ");

    const implicits = [
      this.outImplicitsFrags(this.implicits.filter(s => s.inline)),
      this.outImplicitsConversion(this.implicits.filter(s => !s.inline)),
    ].join("\n  ");

    return {
        core: Array.from(this.topClasses.entries()).map(s => {
            const cls = s[1];
            if (cls) {
              return this.outCls(cls, this.classes);
            } else return "";
          }).join("\n"),
        supporting,
        implicits
    };
  }
}

function createVisitor(ct: ClassTracker) {
  return {
    enter : {
      Root(node: ConcreteRoot) {
        // console.log("Root", node);
        const selections = node.selections.map(s => {
          return {
            ...s,
            parentTpe: [node.name]
          }
        })
        return {
          ...node,
          selections
        };
      },
      Fragment(node: ConcreteFragment) {
        // console.log("Root", node);
        const selections = node.selections.map(s => {
          return {
            ...s,
            parentTpe: [node.name]
          }
        })
        return {
          ...node,
          selections
        };
      },
      InlineFragment(node: ConcreteInlineFragment) {
        const {parentTpe} = node;
        const ptpe = parentTpe || [];
        const selections = node.selections.map(s => {
          return {
            ...s,
            parentTpe: ptpe,
          }
        })
        return {
          ...node,
          selections
        };
      },
      ScalarField(node: ConcreteScalarField) {
        return node;
      },
      LinkedField(node: ConcreteLinkedField) {
        // console.log("Root", node);
        const {parentTpe} = node;
        const ptpe = parentTpe || [];
        const selections = node.selections.map(s => {
          return {
            ...s,
            parentTpe: ptpe.concat([titleCase(node.name)]),
          }
        })
        return {
          ...node,
          selections
        };
      },
      FragmentSpread(node: ConcreteFragmentSpread) {
        return node;
      },
      Condition(node: ConcreteCondition) {
        return node;
      },
    },
    leave: {
      Root(node: ConcreteRoot) {
        // console.log("Root", node);
        ct.closeField(node, false);
        // // $FlowFixMe
        // // node.selections.map(s => ct.handleSelections(s));
        // ct.handleSelections(node);
        return node;
      },
      Fragment(node: ConcreteFragment) {
        // console.log("Fragment", node);
        ct.closeField(node, false);
        // // $FlowFixMe
        // ct.handleSelections(node);
        return node;
      },
      InlineFragment(node: ConcreteInlineFragment) {
        // console.log("InlineFragment", node);
        // node.selections.map(s => s)
        ct.inlineFrag(node);
        return node;
      },
      ScalarField(node: ConcreteScalarField) {
        // console.log("ScalarField", node);
        // $FlowFixMe
        const tpe = ct.transformScalarType((node.type: GraphQLType));
        ct.newMember({name: node.name, tpe, comments: [], scalar: true});
        return node;
      },
      LinkedField(node: ConcreteLinkedField) {
        // console.log("LinkedField", node);
        ct.closeField(node, true);
        return node;
      },
      FragmentSpread(node: ConcreteFragmentSpread) {
        ct.newSpread(node);
        // console.log("FragmentSpread", node);
        return node;
      },
      Condition(node: ConcreteCondition) {
        // console.log("Condition", node);
        return node;
      },
    }
  }
}


function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.substr(1);
}

function flattenArray<T>(arrayOfArrays: Array<Array<T>>): Array<T> {
  const result = [];
  arrayOfArrays.forEach(array => result.push(...array));
  return result;
}

const FLOW_TRANSFORMS: Array<IRTransform> = [
  (ctx: CompilerContext) => FlattenTransform.transform(ctx, {}),
  (ctx: CompilerContext) => SJSTransform.transform(ctx),
];

module.exports = {
  generate,
  flowTransforms: FLOW_TRANSFORMS,
};