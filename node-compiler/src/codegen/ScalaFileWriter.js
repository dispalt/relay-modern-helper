/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @providesModule ScalaFileWriter
 * @flow
 * @format
 */

'use strict';

const RelayCompiler = require('relay-compiler/lib/RelayCompiler');
const RelayFlowGenerator = require('../core/ScalaGenDirect');
const RelayParser = require('relay-compiler/lib/RelayParser');
const RelayValidator = require('relay-compiler/lib/RelayValidator');

const invariant = require('invariant');
const path = require('path');
const writeRelayScalaFile = require('./writeRelayScalaFile');

const {generate} = require('relay-compiler/lib/RelayCodeGenerator');
const {
  ASTConvert,
  CodegenDirectory,
  CompilerContext,
  SchemaUtils,
} = require('relay-compiler/lib/GraphQLCompilerPublic');
const {Map: ImmutableMap} = require('immutable');

import type {ScalarTypeMapping} from 'relay-compiler/lib/RelayFlowTypeTransformers';
import type {
  CompiledDocumentMap,
  CompilerTransforms,
  FileWriterInterface,
} from 'relay-compiler/lib/GraphQLCompilerPublic';
import type {FormatModule} from './writeRelayScalaFile';
// TODO T21875029 ../../relay-runtime/util/RelayConcreteNode
import type {GeneratedNode} from 'relay-compiler/lib/RelayConcreteNode';
import type {DocumentNode, GraphQLSchema} from 'graphql';

const {isOperationDefinitionAST} = SchemaUtils;

export type GenerateExtraFiles = (
  getOutputDirectory: (path?: string) => CodegenDirectory,
  compilerContext: CompilerContext,
  getGeneratedDirectory: (definitionName: string) => CodegenDirectory,
) => void;

export type WriterConfig = {
  baseDir: string,
  compilerTransforms: CompilerTransforms,
  customScalars: ScalarTypeMapping,
  formatModule: FormatModule,
  generateExtraFiles?: GenerateExtraFiles,
  inputFieldWhiteListForFlow: Array<string>,
  outputDir?: string,
  persistQuery?: (text: string) => Promise<string>,
  platform?: string,
  relayRuntimeModule?: string,
  schemaExtensions: Array<string>,
  useHaste: boolean,
  // Haste style module that exports flow types for GraphQL enums.
  // TODO(T22422153) support non-haste environments
  enumsHasteModule?: string,
  packageName?: string,
};

class ScalaFileWriter implements FileWriterInterface {
  _onlyValidate: boolean;
  _config: WriterConfig;
  _baseSchema: GraphQLSchema;
  _baseDocuments: ImmutableMap<string, DocumentNode>;
  _documents: ImmutableMap<string, DocumentNode>;

  constructor(options: {
    config: WriterConfig,
    onlyValidate: boolean,
    baseDocuments: ImmutableMap<string, DocumentNode>,
    documents: ImmutableMap<string, DocumentNode>,
    schema: GraphQLSchema,
  }) {
    const {config, onlyValidate, baseDocuments, documents, schema} = options;
    this._baseDocuments = baseDocuments || ImmutableMap();
    this._baseSchema = schema;
    this._config = config;
    this._documents = documents;
    this._onlyValidate = onlyValidate;

    validateConfig(this._config);
  }

  async writeAll(): Promise<Map<string, CodegenDirectory>> {
    // Can't convert to IR unless the schema already has Relay-local extensions
    const transformedSchema = ASTConvert.transformASTSchema(
      this._baseSchema,
      this._config.schemaExtensions,
    );
    const extendedSchema = ASTConvert.extendASTSchema(
      transformedSchema,
      this._baseDocuments
        .merge(this._documents)
        .valueSeq()
        .toArray(),
    );

    // Build a context from all the documents
    const baseDefinitionNames = new Set();
    this._baseDocuments.forEach(doc => {
      doc.definitions.forEach(def => {
        if (isOperationDefinitionAST(def) && def.name) {
          baseDefinitionNames.add(def.name.value);
        }
      });
    });
    const definitionDirectories = new Map();
    const allOutputDirectories: Map<string, CodegenDirectory> = new Map();
    const addCodegenDir = dirPath => {
      const codegenDir = new CodegenDirectory(dirPath, {
        onlyValidate: this._onlyValidate,
      });
      allOutputDirectories.set(dirPath, codegenDir);
      return codegenDir;
    };

    let configOutputDirectory;
    if (this._config.outputDir) {
      configOutputDirectory = addCodegenDir(this._config.outputDir);
    } else {
      this._documents.forEach((doc, filePath) => {
        doc.definitions.forEach(def => {
          if (isOperationDefinitionAST(def) && def.name) {
            definitionDirectories.set(
              def.name.value,
              path.join(this._config.baseDir, path.dirname(filePath)),
            );
          }
        });
      });
    }

    const packageName = this._config.packageName;

    const definitions = ASTConvert.convertASTDocumentsWithBase(
      extendedSchema,
      this._baseDocuments.valueSeq().toArray(),
      this._documents.valueSeq().toArray(),
      // Verify using local and global rules, can run global verifications here
      // because all files are processed together
      [...RelayValidator.LOCAL_RULES, ...RelayValidator.GLOBAL_RULES],
      RelayParser.transform.bind(RelayParser),
    );

    const compilerContext = new CompilerContext(extendedSchema);
    const compiler = new RelayCompiler(
      this._baseSchema,
      compilerContext,
      this._config.compilerTransforms,
      generate,
    );

    const getGeneratedDirectory = definitionName => {
      if (configOutputDirectory) {
        return configOutputDirectory;
      }
      const definitionDir = definitionDirectories.get(definitionName);
      invariant(
        definitionDir,
        'RelayFileWriter: Could not determine source directory for definition: %s',
        definitionName,
      );
      const generatedPath = path.join(definitionDir, '__generated__');
      let cachedDir = allOutputDirectories.get(generatedPath);
      if (!cachedDir) {
        cachedDir = addCodegenDir(generatedPath);
      }
      return cachedDir;
    };

    compiler.addDefinitions(definitions);

    const transformedFlowContext = RelayFlowGenerator.flowTransforms.reduce(
      (ctx, transform) => transform(ctx, extendedSchema),
      compiler.context(),
    );

    const transformedQueryContext = compiler.transformedQueryContext();
    const compiledDocumentMap: CompiledDocumentMap<
      GeneratedNode,
    > = compiler.compile();

    const existingFragmentNames = new Set(
      definitions.map(definition => definition.name),
    );

    // TODO(T22651734): improve this to correctly account for fragments that
    // have generated flow types.
    baseDefinitionNames.forEach(baseDefinitionName => {
      existingFragmentNames.delete(baseDefinitionName);
    });

    try {
      const nodes = transformedFlowContext.documents();
      await Promise.all(
        nodes.map(async node => {
          if (baseDefinitionNames.has(node.name)) {
            // don't add definitions that were part of base context
            return;
          }

          const relayRuntimeModule =
            this._config.relayRuntimeModule || 'relay-runtime';

          const compiledNode = compiledDocumentMap.get(node.name);
          invariant(
            compiledNode,
            'RelayCompiler: did not compile definition: %s',
            node.name,
          );

          const flowTypes = RelayFlowGenerator.generate(node, {
            customScalars: this._config.customScalars,
            enumsHasteModule: this._config.enumsHasteModule,
            existingFragmentNames,
            inputFieldWhiteList: this._config.inputFieldWhiteListForFlow,
            relayRuntimeModule,
            useHaste: this._config.useHaste,
          }, null, extendedSchema, nodes);

          await writeRelayScalaFile(
            getGeneratedDirectory(compiledNode.name),
            compiledNode,
            this._config.formatModule,
            flowTypes.core,
            this._config.persistQuery,
            this._config.platform,
            relayRuntimeModule,
            packageName,
            flowTypes.supporting,
            flowTypes.implicits,
            flowTypes.objectParent
          );
        }),
      );

      if (this._config.generateExtraFiles) {
        const configDirectory = this._config.outputDir;
        this._config.generateExtraFiles(
          dir => {
            const outputDirectory = dir || configDirectory;
            invariant(
              outputDirectory,
              'ScalaFileWriter: cannot generate extra files without specifying ' +
                'an outputDir in the config or passing it in.',
            );
            let outputDir = allOutputDirectories.get(outputDirectory);
            if (!outputDir) {
              outputDir = addCodegenDir(outputDirectory);
            }
            return outputDir;
          },
          transformedQueryContext,
          getGeneratedDirectory,
        );
      }

      // clean output directories
      allOutputDirectories.forEach(dir => {
        dir.deleteExtraFiles();
      });
    } catch (error) {
      let details;
      try {
        details = JSON.parse(error.message);
      } catch (_) {}
      if (details && details.name === 'GraphQL2Exception' && details.message) {
        throw new Error('GraphQL error writing modules:\n' + details.message);
      }
      throw new Error('Error writing modules:\n' + error.toString());
    }

    return allOutputDirectories;
  }
}

function validateConfig(config: Object): void {
  if (config.buildCommand) {
    process.stderr.write(
      'WARNING: ScalaFileWriter: For ScalaFileWriter to work you must ' +
        'replace config.buildCommand with config.formatModule.\n',
    );
  }
}

module.exports = ScalaFileWriter;