import { CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';
import { CompletionFunctionParams } from '../../utils/addon-api';
import * as memoize from 'memoizee';
import { log, logError, logInfo } from '../../utils/logger';
import Server from '../../server';
import { Project } from '../../project';
import * as t from '@babel/types';
import {
  isStoreModelLookup,
  isRouteLookup,
  isModelReference,
  isNamedServiceInjection,
  isTransformReference,
  isComputedPropertyArgument,
  closestScriptNodeParent,
} from '../../utils/ast-helpers';
import { listRoutes, listModels, listServices, mGetProjectAddonsInfo, listTransforms } from '../../utils/layout-helpers';

const mListRoutes = memoize(listRoutes, { length: 1, maxAge: 60000 });
const mListModels = memoize(listModels, { length: 1, maxAge: 60000 });
const mListServices = memoize(listServices, { length: 1, maxAge: 60000 });
const mListTransforms = memoize(listTransforms, { length: 1, maxAge: 60000 });

export default class ScriptCompletionProvider {
  meta: { [key: string]: boolean } = {
    modelsRegistryInitialized: false,
    routesRegistryInitialized: false,
    servicesRegistryInitialized: false,
    projectAddonsInfoInitialized: false,
    transformsRegistryInitialized: false,
  };
  server!: Server;
  project!: Project;
  enableRegistryCache(value: string) {
    if (this.server.flags.hasExternalFileWatcher) {
      this.meta[value] = true;
    }
  }
  async initRegistry(_: Server, project: Project) {
    this.project = project;
    this.server = _;

    if (project.flags.enableEagerRegistryInitialization) {
      try {
        const initStartTime = Date.now();

        mListModels(project.root);
        this.enableRegistryCache('modelsRegistryInitialized');
        mListServices(project.root);
        this.enableRegistryCache('servicesRegistryInitialized');
        logInfo(project.root + ': script registry initialized in ' + (Date.now() - initStartTime) + 'ms');
      } catch (e) {
        logError(e);
      }
    } else {
      logInfo('EagerRegistryInitialization is disabled for "' + project.name + '" (script-completion-provider)');
    }
  }
  async onComplete(root: string, params: CompletionFunctionParams): Promise<CompletionItem[]> {
    const focusPath = params.focusPath;

    if (params.type !== 'script') {
      return params.results;
    }

    log('script:onComplete');
    const completions: CompletionItem[] = params.results;

    try {
      if (isStoreModelLookup(focusPath) || isModelReference(focusPath)) {
        log('isStoreModelLookup || isModelReference');

        if (!this.meta.modelsRegistryInitialized) {
          mListModels(root);
          this.enableRegistryCache('modelsRegistryInitialized');
        }

        if (!this.meta.projectAddonsInfoInitialized) {
          mGetProjectAddonsInfo(root);
          this.enableRegistryCache('projectAddonsInfoInitialized');
        }

        const registry = this.server.getRegistry(this.project.roots);

        Object.keys(registry.model).forEach((rawModelName) => {
          completions.push({
            kind: CompletionItemKind.Class,
            detail: 'model',
            label: rawModelName,
          });
        });
      } else if (isRouteLookup(focusPath)) {
        log('isRouteLookup');

        if (!this.meta.routesRegistryInitialized) {
          mListRoutes(root);
          this.enableRegistryCache('routesRegistryInitialized');
        }

        if (!this.meta.projectAddonsInfoInitialized) {
          mGetProjectAddonsInfo(root);
          this.enableRegistryCache('projectAddonsInfoInitialized');
        }

        const registry = this.server.getRegistry(this.project.roots);

        Object.keys(registry.routePath).forEach((rawRouteName) => {
          completions.push({
            kind: CompletionItemKind.File,
            detail: 'route',
            label: rawRouteName,
          });
        });
      } else if (isNamedServiceInjection(focusPath)) {
        log('isNamedServiceInjection');

        if (!this.meta.servicesRegistryInitialized) {
          mListServices(root);
          this.enableRegistryCache('servicesRegistryInitialized');
        }

        if (!this.meta.projectAddonsInfoInitialized) {
          mGetProjectAddonsInfo(root);
          this.enableRegistryCache('projectAddonsInfoInitialized');
        }

        const registry = this.server.getRegistry(this.project.roots);

        Object.keys(registry.service).forEach((rawServiceName) => {
          completions.push({
            kind: CompletionItemKind.Class,
            detail: 'service',
            label: rawServiceName,
          });
        });
      } else if (isComputedPropertyArgument(focusPath)) {
        log('isComputedPropertyArgument');

        if (!focusPath.parentPath || !focusPath.parentPath.parentPath) {
          return [];
        }

        const node = closestScriptNodeParent(focusPath, 'ObjectExpression', ['ObjectProperty']) || closestScriptNodeParent(focusPath, 'ClassBody');

        if (node === null) {
          log('isComputedPropertyArgument - unable to find keys');

          return [];
        }

        (node.properties || node.body || []).forEach((property: t.ObjectProperty) => {
          let name = null;

          if (property.key.type === 'StringLiteral') {
            name = property.key.value;
          } else if (property.key.type === 'Identifier') {
            name = property.key.name;
          }

          if (name !== null) {
            completions.push({
              kind: 10,
              label: name,
              detail: 'ObjectProperty',
            });
          }
        });
      } else if (isTransformReference(focusPath)) {
        log('isTransformReference');

        if (!this.meta.transformsRegistryInitialized) {
          mListTransforms(root);
          this.enableRegistryCache('transformsRegistryInitialized');
        }

        if (!this.meta.projectAddonsInfoInitialized) {
          mGetProjectAddonsInfo(root);
          this.enableRegistryCache('projectAddonsInfoInitialized');
        }

        const registry = this.server.getRegistry(this.project.roots);

        Object.keys(registry.transform).forEach((rawTransformName) => {
          completions.push({
            kind: CompletionItemKind.Function,
            detail: 'transform',
            label: rawTransformName,
          });
        });
      }
    } catch (e) {
      log('error', e);
    }

    log('completions', completions);

    return completions;
  }
}
