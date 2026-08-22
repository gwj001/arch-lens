<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 时序

根据提供的信息，无法描述该项目的“典型主流程调用顺序”。摘要中仅包含以下与流程相关的事实：

- 各包的入口文件是独立的，但没有说明这些入口之间的调用方向或先后关系。
- 依赖关系只能说明包之间的引用关系，例如 `client-arch-lens` 依赖 `@deepseek-ai/dsh-arch-lens-backend`、`code-index-tree-sitter` 依赖 `@deepseek-ai/dsh-code-index`、`arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`，但依赖关系并不等价于运行时的调用时序。
- 摘要列出了顶层实体（如 `AnalysisEvent`、`ArchView`、`CodeEntity` 等），但没有说明它们之间如何被触发或按什么顺序执行。
- 没有提供用户输入如何进入系统、以及输出/回复如何产生的任何描述。

因此，在“禁止编造摘要中不存在的流程步骤”的约束下，不能给出具体的 `sequenceDiagram` 或有序调用列表。需要补充组件间的调用/消息传递定义后，才能描述该项目的核心时序。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 时序

根据提供的信息，无法描述该项目的“典型主流程调用顺序”。摘要中仅包含以下与流程相关的事实：

- 各包的入口文件是独立的，但没有说明这些入口之间的调用方向或先后关系。
- 依赖关系只能说明包之间的引用关系，例如 `client-arch-lens` 依赖 `@deepseek-ai/dsh-arch-lens-backend`、`code-index-tree-sitter` 依赖 `@deepseek-ai/dsh-code-index`、`arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`，但依赖关系并不等价于运行时的调用时序。
- 摘要列出了顶层实体（如 `AnalysisEvent`、`ArchView`、`CodeEntity` 等），但没有说明它们之间如何被触发或按什么顺序执行。
- 没有提供用户输入如何进入系统、以及输出/回复如何产生的任何描述。

因此，在“禁止编造摘要中不存在的流程步骤”的约束下，不能给出具体的 `sequenceDiagram` 或有序调用列表。需要补充组件间的调用/消息传递定义后，才能描述该项目的核心时序。

## 包目录职责

- **arch-lens-backend**：提供架构分析的后端逻辑，定义分析事件、分析流程、分析档案及配置解析相关实体与函数。
- **client-arch-lens**：提供架构视图的 React 客户端实现，包含概念节点、核心事件、视图配置与渲染组件。
- **code-index**：定义代码索引的核心数据模型，包括代码实体、代码包、导入关系、调用边及索引结果。
- **code-index-tree-sitter**：基于 tree-sitter 实现源码文件发现、语言检测、包根目录发现及源码路径解析等功能。
- **typert-protocol**：定义远程类型调用协议相关实体，包括网关绑定选项、绑定对象、远程方法标记及调用标记。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 时序

根据提供的信息，无法描述该项目的“典型主流程调用顺序”。摘要中仅包含以下与流程相关的事实：

- 各包的入口文件是独立的，但没有说明这些入口之间的调用方向或先后关系。
- 依赖关系只能说明包之间的引用关系，例如 `client-arch-lens` 依赖 `@deepseek-ai/dsh-arch-lens-backend`、`code-index-tree-sitter` 依赖 `@deepseek-ai/dsh-code-index`、`arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`，但依赖关系并不等价于运行时的调用时序。
- 摘要列出了顶层实体（如 `AnalysisEvent`、`ArchView`、`CodeEntity` 等），但没有说明它们之间如何被触发或按什么顺序执行。
- 没有提供用户输入如何进入系统、以及输出/回复如何产生的任何描述。

因此，在“禁止编造摘要中不存在的流程步骤”的约束下，不能给出具体的 `sequenceDiagram` 或有序调用列表。需要补充组件间的调用/消息传递定义后，才能描述该项目的核心时序。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 时序

根据提供的信息，无法描述该项目的“典型主流程调用顺序”。摘要中仅包含以下与流程相关的事实：

- 各包的入口文件是独立的，但没有说明这些入口之间的调用方向或先后关系。
- 依赖关系只能说明包之间的引用关系，例如 `client-arch-lens` 依赖 `@deepseek-ai/dsh-arch-lens-backend`、`code-index-tree-sitter` 依赖 `@deepseek-ai/dsh-code-index`、`arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`，但依赖关系并不等价于运行时的调用时序。
- 摘要列出了顶层实体（如 `AnalysisEvent`、`ArchView`、`CodeEntity` 等），但没有说明它们之间如何被触发或按什么顺序执行。
- 没有提供用户输入如何进入系统、以及输出/回复如何产生的任何描述。

因此，在“禁止编造摘要中不存在的流程步骤”的约束下，不能给出具体的 `sequenceDiagram` 或有序调用列表。需要补充组件间的调用/消息传递定义后，才能描述该项目的核心时序。

## 包目录职责

- **arch-lens-backend**：提供架构分析的后端逻辑，定义分析事件、分析流程、分析档案及配置解析相关实体与函数。
- **client-arch-lens**：提供架构视图的 React 客户端实现，包含概念节点、核心事件、视图配置与渲染组件。
- **code-index**：定义代码索引的核心数据模型，包括代码实体、代码包、导入关系、调用边及索引结果。
- **code-index-tree-sitter**：基于 tree-sitter 实现源码文件发现、语言检测、包根目录发现及源码路径解析等功能。
- **typert-protocol**：定义远程类型调用协议相关实体，包括网关绑定选项、绑定对象、远程方法标记及调用标记。

## 核心交互

摘要中未直接提供「生产者 → 事件 → 消费者」的完整事件链路。可确认的事件实体及依赖关系如下：

### 事件实体

- `AnalysisEvent`：位于 `arch-lens-backend` 包。
- `CoreEvent`：位于 `client-arch-lens` 包。

### 基于包依赖关系的服务交互方向

- `client-arch-lens` → `@deepseek-ai/dsh-arch-lens-backend`：客户端包依赖后端包，存在客户端对后端的调用方向。
- `arch-lens-backend` → `@deepseek-ai/dsh-typert-protocol`：后端包依赖协议包，存在后端对远程交互协议的使用。
- `code-index-tree-sitter` → `@deepseek-ai/dsh-code-index`：tree-sitter 实现包依赖代码索引抽象包，存在实现层对抽象层的调用。
- 各包均依赖 `@deepseek-ai/cordis`，摘要未说明该依赖的具体职责，仅列出依赖事实。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 包目录职责

- **arch-lens-backend**：提供架构分析的后端逻辑，定义分析事件、分析流程、分析档案及配置解析相关实体与函数。
- **client-arch-lens**：提供架构视图的 React 客户端实现，包含概念节点、核心事件、视图配置与渲染组件。
- **code-index**：定义代码索引的核心数据模型，包括代码实体、代码包、导入关系、调用边及索引结果。
- **code-index-tree-sitter**：基于 tree-sitter 实现源码文件发现、语言检测、包根目录发现及源码路径解析等功能。
- **typert-protocol**：定义远程类型调用协议相关实体，包括网关绑定选项、绑定对象、远程方法标记及调用标记。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

<!-- arch-lens generated -->

## 概念层级

### 分析档案与流程
- AnalysisEvent、AnalysisFlow、ArchLensAnalysisProfile：表达架构分析的触发事件、执行流程与配置档案。
- resolveProfile、ensureAnalysisProfile、profileFromText、clearAnalysisProfileCache、cacheName：负责分析档案的解析、创建、文本化处理与缓存管理。

### 代码索引模型
- CodeEntity、CodeImport、CodePackage、CallEdge：描述代码实体、依赖引入、包组织和调用关系。
- CodeIndexResult、CodeLanguage、Context、abstract：构成索引结果的类型语义、语言信息以及索引上下文抽象。

### 源码发现与解析
- fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources、resolveUnder：处理源码目录探测、语言识别、包根发现与源码文件收集。

### 客户端可视化与交互
- ConceptNode、Selection、CoreEvent、CoreState、MermaidState：描述客户端核心状态、概念节点、事件与选择行为。
- ArchView、ArchViewProps、ArchViewConfig：提供架构视图组件、属性接口与视图配置。

### 远程协议与绑定
- TypertGatewayBinding、TypertGatewayBindingOptions、RemoteInitializerContext：定义远程调用网关的绑定方式与初始化上下文。
- RemoteMethodMarker、StoredRemoteMethodMarker、RemoteInvocationMarker、TypertLookupFailure：用于标记远程方法、存储标记、发起调用以及表示查找失败结果。

## 包目录职责

- **arch-lens-backend**：提供架构分析的后端逻辑，定义分析事件、分析流程、分析档案及配置解析相关实体与函数。
- **client-arch-lens**：提供架构视图的 React 客户端实现，包含概念节点、核心事件、视图配置与渲染组件。
- **code-index**：定义代码索引的核心数据模型，包括代码实体、代码包、导入关系、调用边及索引结果。
- **code-index-tree-sitter**：基于 tree-sitter 实现源码文件发现、语言检测、包根目录发现及源码路径解析等功能。
- **typert-protocol**：定义远程类型调用协议相关实体，包括网关绑定选项、绑定对象、远程方法标记及调用标记。

## 核心交互

摘要中未直接提供「生产者 → 事件 → 消费者」的完整事件链路。可确认的事件实体及依赖关系如下：

### 事件实体

- `AnalysisEvent`：位于 `arch-lens-backend` 包。
- `CoreEvent`：位于 `client-arch-lens` 包。

### 基于包依赖关系的服务交互方向

- `client-arch-lens` → `@deepseek-ai/dsh-arch-lens-backend`：客户端包依赖后端包，存在客户端对后端的调用方向。
- `arch-lens-backend` → `@deepseek-ai/dsh-typert-protocol`：后端包依赖协议包，存在后端对远程交互协议的使用。
- `code-index-tree-sitter` → `@deepseek-ai/dsh-code-index`：tree-sitter 实现包依赖代码索引抽象包，存在实现层对抽象层的调用。
- 各包均依赖 `@deepseek-ai/cordis`，摘要未说明该依赖的具体职责，仅列出依赖事实。

## 时序

一次典型主流程的调用顺序如下：

1. 用户请求进入 `client-arch-lens` 的入口：`src/client/index.ts` 或 `src/index.ts`。
2. `client-arch-lens` 通过依赖 `@deepseek-ai/dsh-arch-lens-backend`，调用 `arch-lens-backend` 的入口：`src/index.ts`。
3. `arch-lens-backend` 调用 `profileFromText`，将输入文本转换为 `ArchLensAnalysisProfile`。
4. `arch-lens-backend` 调用 `ensureAnalysisProfile` 确保分析 profile 可用，并配合 `cacheName` / `clearAnalysisProfileCache` 进行缓存管理。
5. `arch-lens-backend` 调用 `resolveProfile` 解析出最终生效的分析 profile。
6. `arch-lens-backend` 执行 `AnalysisFlow`，产生 `AnalysisEvent` 作为分析结果输出。

<!-- arch-lens generated -->

## 概念层级

### 1. 远程交互底座
该层提供了跨模块或跨进程远程调用的基础抽象，包括网关绑定相关概念（`TypertGatewayBinding`、`TypertGatewayBindingOptions`）、远程方法标记（`RemoteMethodMarker`、`StoredRemoteMethodMarker`、`RemoteInvocationMarker`）、远程初始化上下文（`RemoteInitializerContext`）以及查找失败表示（`TypertLookupFailure`）。后端架构生成层依赖此协议层，因此远程交互概念位于更底层。

### 2. 代码索引与源码发现层
该层围绕代码索引结果模型展开，包含代码实体（`CodeEntity`）、代码导入关系（`CodeImport`）、代码包（`CodePackage`）、调用边（`CallEdge`）、代码语言（`CodeLanguage`）、索引结果（`CodeIndexResult`）与上下文（`Context`）等概念。底层还存在一系列源码发现操作，包括语言检测（`detectLanguage`）、包根发现（`discoverPackageRoots`）、源码收集（`collectSources`）、目录列举（`listDirs`）、相对路径计算（`relPath`）、存在性检查（`fileExists`、`dirExists`）以及路径解析（`resolveUnder`）。这些操作服务于代码索引模型的构建，但具体机制不在摘要范围内。

### 3. 架构生成与信号层
该层负责架构生成过程中的阶段与信号控制，核心概念包括生成阶段标记（`beginGenerationStage`、`endGenerationStage`）、阶段报告（`reportGeneration`）、生成信号（`generationSignal`）、生成中止（`abortGeneration`）、插槽（`slotFor`）、通知（`notify`）以及尾部预览（`tailPreview`）。该层以远程交互底座为基础，因为其依赖远程协议层；同时也可被上层客户端所依赖。

### 4. 客户端架构视图层
该层面向用户展示与交互，核心概念包括架构视图（`ArchView`）、视图配置（`ArchViewConfig`、`ArchViewProps`）、核心状态与事件（`CoreState`、`CoreEvent`）、选择状态（`Selection`）、概念节点（`ConceptNode`）以及目录属性（`CatalogProps`）。该层依赖架构生成层，从而获得后端能力来驱动视图内容与交互流程。

## 时序

基于摘要中的入口与依赖关系，可确认的主流程调用方向如下：

1. 用户从 `client-arch-lens` 入口（`src/client/index.ts` 或 `src/index.ts`）开始。
2. `client-arch-lens` → `arch-lens-backend` 入口（`src/index.ts`），因为 `client-arch-lens` 依赖 `@deepseek-ai/dsh-arch-lens-backend`。
3. `arch-lens-backend` → `typert-protocol` 入口（`src/index.ts`），因为 `arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`。

代码索引侧存在独立的依赖调用方向：

4. `code-index-tree-sitter` 入口（`src/index.ts`）→ `code-index` 入口（`src/index.ts`），因为 `code-index-tree-sitter` 依赖 `@deepseek-ai/dsh-code-index`。

摘要未提供更多跨调用链信息，因此无法确定更细粒度的函数级时序。

## 核心交互

根据项目摘要中的包依赖关系和顶层实体，核心事件/服务交互如下：

- **包间服务交互（消费者 → 提供者）**
  - `client-arch-lens` → `arch-lens-backend`  
    通过依赖 `@deepseek-ai/dsh-arch-lens-backend`，客户端包可使用后端包暴露的 `generationSignal`、`notify`、`beginGenerationStage`、`reportGeneration`、`endGenerationStage`、`tailPreview` 等顶层实体。
  - `code-index-tree-sitter` → `code-index`  
    通过依赖 `@deepseek-ai/dsh-code-index`，语法树解析包可使用索引包定义的 `CodeEntity`、`CodeImport`、`CallEdge`、`CodeIndexResult` 等类型。
  - `arch-lens-backend` → `typert-protocol`  
    通过依赖 `@deepseek-ai/dsh-typert-protocol`，后端包可使用 `TypertGatewayBinding`、`RemoteMethodMarker`、`RemoteInvocationMarker` 等远程调用相关实体。
  - `code-index` → `@deepseek-ai/cordis`，`typert-protocol` → `@deepseek-ai/cordis`  
    两者均依赖 `@deepseek-ai/cordis`，且分别在其顶层实体中暴露了 `Context` 或 `abstract` 相关内容。

- **可识别的事件/信号实体**
  - `arch-lens-backend` 中暴露了 `generationSignal`、`abortGeneration`、`notify`、`beginGenerationStage`、`reportGeneration`、`endGenerationStage`、`tailPreview`，其中 `generationSignal` 与 `notify` 具有信号/事件语义。
  - `client-arch-lens` 中暴露了 `CoreEvent` 事件类型，但摘要未说明其具体生产者或消费流程。

摘要中未提供更具体的“生产者 → 事件 → 消费者”绑定信息，因此仅列出以上基于包依赖与顶层实体可确认的交互关系。

## 依赖

### 依赖关系概览

- `arch-lens-backend` 依赖 `zod`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-typert-protocol`
- `client-arch-lens` 依赖 `mermaid`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-arch-lens-backend`、`@deepseek-ai/cordis`、`react`、`react-dom`
- `code-index` 依赖 `@deepseek-ai/cordis`
- `code-index-tree-sitter` 依赖 `tree-sitter`、`tree-sitter-typescript`、`tree-sitter-python`、`tree-sitter-java`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-code-index`
- `typert-protocol` 依赖 `@deepseek-ai/cordis`

### 分层说明

- `@deepseek-ai/cordis` 被所有包共同依赖，是所有模块共享的基础依赖。
- `typert-protocol` 和 `code-index` 是相对底层的包，分别提供协议相关与代码索引基础相关的实体能力；它们都只依赖 `@deepseek-ai/cordis`。
- `arch-lens-backend` 依赖 `@deepseek-ai/dsh-typert-protocol`，说明其使用了 typert-protocol 提供的协议相关类型或能力。
- `code-index-tree-sitter` 同时依赖 `tree-sitter` 系列与 `@deepseek-ai/dsh-code-index`，说明其既依赖具体语言的语法解析能力，也依赖 `code-index` 提供的代码索引基础实体/结果类型。
- `client-arch-lens` 是前端展示层，依赖 React 相关库用于 UI 渲染，依赖 `mermaid` 用于图展示，依赖 `@deepseek-ai/dsh-arch-lens-backend` 以接入后端能力，同时依赖 `@deepseek-ai/schemastery` 和 `@deepseek-ai/cordis` 作为配置/基础设施。

### 依赖方向

从依赖关系可以得出以下方向：

- `client-arch-lens` → `@deepseek-ai/dsh-arch-lens-backend`（前端依赖后端能力）
- `arch-lens-backend` → `@deepseek-ai/dsh-typert-protocol`（后端依赖协议基础）
- `code-index-tree-sitter` → `@deepseek-ai/dsh-code-index`（具体实现依赖基础索引模型）
- 各包均 → `@deepseek-ai/cordis`（公共基础设施依赖）

整体上形成一条清晰的依赖链：`typert-protocol` / `code-index` 作为基础层，`arch-lens-backend` / `code-index-tree-sitter` 作为能力实现层，`client-arch-lens` 作为前端展示/交互层。

## 实体关系

根据项目摘要，仅列出了各包顶层实体，未提供实体之间的继承/实现/引用关系。以下为按包划分的顶层实体列表：

- arch-lens-backend：generationSignal、abortGeneration、slotFor、notify、beginGenerationStage、reportGeneration、endGenerationStage、tailPreview
- client-arch-lens：ConceptNode、CoreEvent、ArchViewConfig、ArchViewProps、Selection、CoreState、ArchView、CatalogProps
- code-index：abstract、Context、CodeEntity、CodeImport、CodePackage、CallEdge、CodeIndexResult、CodeLanguage
- code-index-tree-sitter：resolveUnder、fileExists、dirExists、detectLanguage、discoverPackageRoots、listDirs、relPath、collectSources
- typert-protocol：TypertLookupFailure、abstract、TypertGatewayBindingOptions、TypertGatewayBinding、RemoteMethodMarker、RemoteInitializerContext、StoredRemoteMethodMarker、RemoteInvocationMarker

注意：其中 `code-index` 和 `typert-protocol` 都包含名为 `abstract` 的顶层实体，摘要未进一步说明二者是否相关或为同名不同实体。

## 包目录职责

- **arch-lens-backend**：提供后端生成信号、中止生成、槽位、通知、生成阶段管理及尾部预览等核心逻辑的 TypeScript 实现。
- **client-arch-lens**：基于 React 等依赖实现架构视图前端，包含概念节点、核心事件、视图配置、选择状态、核心状态等展示与交互实体。
- **code-index**：定义代码索引的抽象模型与结果类型，包括代码实体、导入、包、调用边、语言及索引结果，并依托 cordis 提供上下文。
- **code-index-tree-sitter**：基于 tree-sitter 系列解析器实现源码收集、语言检测、包根发现、路径解析等代码索引辅助能力，并依赖 code-index 的抽象定义。
- **typert-protocol**：定义远程类型网关的绑定选项、绑定结构、远程方法标记、初始化上下文及调用标记等协议相关实体。
