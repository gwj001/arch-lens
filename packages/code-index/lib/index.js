import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
/**
* Service Definition for the code-index capability seam. Providers implement
* language-aware entity/import extraction; consumers (arch-lens graphs,
* code-grounded explains, future search) read only this contract.
* @module @deepseek-ai/dsh-code-index
*/
/**
* Code-index Service Definition contract: index a workspace into packages,
* entities, imports, and composition. Providers are replaceable (tree-sitter
* today, semantic backends later); consumers never see the provider.
*/
var CodeIndex = class extends Service {
	constructor(ctx) {
		super(ctx, "codeIndex");
	}
};
//#endregion
export { CodeIndex, CodeIndex as default };
