import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region ../../../vendor/cosmokit/src/misc.ts
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
//#endregion
//#region ../../../vendor/cosmokit/src/types.ts
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
let Binary;
(function(_Binary) {
	_Binary.is = isArrayBufferLike;
	_Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	_Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	_Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	_Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	_Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	_Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
//#endregion
//#region ../../../vendor/cosmokit/src/time.ts
let Time;
(function(_Time) {
	_Time.millisecond = 1;
	const second = _Time.second = 1e3;
	const minute = _Time.minute = second * 60;
	const hour = _Time.hour = minute * 60;
	const day = _Time.day = hour * 24;
	const week = _Time.week = day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	_Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	_Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / minute - offset) / 1440);
	}
	_Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * minute);
	}
	_Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
	}
	_Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	_Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
		else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
		else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
		else if (abs >= second) return Math.round(ms / second) + "s";
		return ms + "ms";
	}
	_Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	_Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	_Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
/** Timestamp format for note headings. */
function timestamp(now) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
/**
* Append one note entry to `ARCH-NOTES.md` under the workspace root and bound
* the file to {@link MAX_NOTE_ENTRIES} entries. This is the only write path.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param input - target label, question head, and answer text.
* @param notesFile - note file name (default ARCH-NOTES.md).
* @returns success or error result.
*/
async function appendNote(fs, root, input, notesFile) {
	try {
		const target = await fs.resolve(notesFile, { cwd: root });
		const info = await fs.stat(target);
		const questionHead = input.question.split("\n")[0]?.slice(0, 100) ?? "架构讲解";
		const answer = input.answer.trim().slice(0, 600) || "（回答为空）";
		const entry = `\n## [${timestamp(/* @__PURE__ */ new Date())}] (${input.target}) ${questionHead}\n\n**问**：${questionHead}\n\n**答**：${answer}\n`;
		if (info === void 0 || info.type !== "file") {
			await fs.writeText(target, "# 架构笔记（ARCH-NOTES）\n\n由架构学习台自动维护：每次 AI 讲解（含回答）追加一条记录。\n" + entry);
			return { ok: true };
		}
		const trimmed = trimToLimit(await fs.readText(target) + entry);
		await fs.writeText(target, trimmed);
		return { ok: true };
	} catch (error) {
		return { error: `note write failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Trim a note file to at most {@link MAX_NOTE_ENTRIES} `## [` headings,
* keeping the file header and the most recent entries.
* @param text - full note file text.
* @returns text with old entries removed from the head.
*/
function trimToLimit(text) {
	const lines = text.split("\n");
	const heads = lines.map((line, index) => ({
		line,
		index
	})).filter(({ line }) => /^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(line));
	if (heads.length <= 200) return text;
	const keepFrom = heads[heads.length - 200].index;
	return lines.slice(keepFrom).join("\n");
}
/**
* Parse the note file into listing entries, newest first.
* @param text - note file text.
* @returns parsed entries.
*/
function parseNotes(text) {
	const entries = [];
	let current = null;
	for (const line of text.split("\n")) {
		const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((.*?)\)(.*)$/.exec(line);
		if (match !== null) {
			const [, time, target, rest] = match;
			current = {
				heading: `${time ?? ""}|${target ?? ""}|${(rest ?? "").trim()}`,
				body: []
			};
			entries.push(current);
		} else if (current !== null) current.body.push(line);
	}
	return entries;
}
/**
* Read the note file into the client listing shape, newest first.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param notesFile - note file name.
* @returns the listing result.
*/
async function readNotes(fs, root, notesFile) {
	try {
		const target = await fs.resolve(notesFile, { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return {
			path: notesFile,
			entries: []
		};
		return {
			path: notesFile,
			entries: parseNotes(await fs.readText(target)).map((entry) => {
				const [time, targetName, rest] = entry.heading.split("|");
				return {
					time: time ?? "",
					target: targetName ?? "",
					preview: rest !== void 0 && rest.length > 0 ? rest.slice(0, 80) : "(讲解)"
				};
			}).reverse()
		};
	} catch (error) {
		return { error: `note read failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
//#endregion
//#region lib/types/scan.js
/**
* Workspace repository scanning for the Arch Lens backend: package graph,
* README blurbs, src file lists, and per-package detail projection.
* @module @deepseek-ai/dsh-arch-lens-backend/src/scan
*/
/** Max bytes read for package.json / README / entry source (guards huge files). */
const MAX_HEAD_BYTES = 262144;
/**
* Read a JSON file next to a package, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @returns parsed JSON, or null when absent/unreadable/oversized.
*/
async function readJson(fs, base) {
	try {
		const target = await fs.resolve("package.json", { cwd: base });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_HEAD_BYTES) return null;
		return JSON.parse(await fs.readText(target));
	} catch {
		return null;
	}
}
/**
* Read the head of a text file, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @param name - relative file name.
* @param max - max characters to keep.
* @returns the head text, or '' when absent/unreadable/oversized.
*/
async function readHead(fs, base, name, max) {
	try {
		const target = await fs.resolve(name, { cwd: base });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_HEAD_BYTES) return "";
		return (await fs.readText(target)).slice(0, max);
	} catch {
		return "";
	}
}
/**
* First non-empty, non-heading, non-comment paragraph of a README head.
* @param text - the README head text.
* @returns the trimmed first paragraph (bounded).
*/
function firstParagraph(text) {
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--") && !line.startsWith("```"));
	return lines[0] !== void 0 ? lines[0].slice(0, 220) : "";
}
/**
* List src/ file names of a package, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @returns up to 24 file names.
*/
async function listSrc(fs, base) {
	try {
		const src = await fs.resolve("src", { cwd: base });
		return (await fs.listDir(src)).filter((entry) => entry.type === "file").map((entry) => entry.name).slice(0, 24);
	} catch {
		return [];
	}
}
/**
* Classify a src file name into a role.
* @param name - file basename.
* @returns the role label.
*/
function roleOf(name) {
	if (name === "index.ts" || name === "index.js") return "entry";
	if (name === "types.ts") return "types";
	if (name === "invariant.ts") return "invariant";
	if (name === "apply.ts") return "assembly";
	if (name.endsWith(".spec.ts") || name.endsWith(".e2e.ts")) return "test";
	return "";
}
/**
* Scan the workspace `packages/<group>/<pkg>` tree into a graph.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @returns the graph, or an error result.
*/
async function scanWorkspace(fs, root) {
	const nodes = [];
	const edges = [];
	const groups = /* @__PURE__ */ new Set();
	try {
		const packagesTarget = await fs.resolve("packages", { cwd: root });
		const groupEntries = (await fs.listDir(packagesTarget)).filter((entry) => entry.type === "directory");
		for (const group of groupEntries) {
			groups.add(group.name);
			const pkgEntries = (await fs.listDir(group.target)).filter((entry) => entry.type === "directory");
			for (const pkg of pkgEntries) {
				const base = pkg.target.displayPath;
				const meta = await readJson(fs, base);
				if (meta === null || typeof meta.name !== "string" || meta.name.length === 0) continue;
				const short = meta.name.replace(/^@deepseek-ai\/dsh-/, "");
				const deps = typeof meta.peerDependencies === "object" && meta.peerDependencies !== null ? Object.keys(meta.peerDependencies).filter((key) => key.startsWith("@deepseek-ai/dsh-")).map((key) => key.replace(/^@deepseek-ai\/dsh-/, "")) : [];
				for (const dep of deps) edges.push({
					from: short,
					to: dep
				});
				const blurb = firstParagraph(await readHead(fs, base, "README.md", 400));
				const files = await listSrc(fs, base);
				nodes.push({
					id: short,
					short,
					group: group.name,
					blurb,
					files,
					deps,
					path: base
				});
			}
		}
	} catch (error) {
		return { error: `scan failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	return {
		root,
		groups: [...groups].sort(),
		nodes,
		edges
	};
}
/**
* Project one package into its detail view.
* @param fs - the filesystem service.
* @param graph - the scanned graph.
* @param node - the package node.
* @returns the detail projection.
*/
async function componentDetail(fs, graph, node) {
	const files = node.files.map((name) => ({
		name,
		role: roleOf(name)
	}));
	let snippet = "";
	const keyLines = [];
	const entryName = node.files.includes("index.ts") ? "index.ts" : node.files.includes("index.js") ? "index.js" : node.files[0];
	if (entryName !== void 0) {
		const head = await readHead(fs, node.path, `src/${entryName}`, 12e3);
		snippet = head.split("\n").slice(0, 90).map((line) => line.length > 140 ? `${line.slice(0, 137)}…` : line).join("\n");
		const registration = /(ctx\.(on|provide|effect|emit|waterfall|serial|parallel|inject)\(|\.register\(|harness\.(handle|registerTool)\(|@Remote\()/;
		for (const line of head.split("\n")) {
			if (registration.test(line)) keyLines.push(line.trim().slice(0, 120));
			if (keyLines.length >= 18) break;
		}
	}
	const dependents = graph.nodes.filter((candidate) => candidate.deps.includes(node.short)).map((candidate) => candidate.short);
	return {
		id: node.short,
		short: node.short,
		group: node.group,
		blurb: node.blurb,
		files,
		deps: node.deps.slice(0, 40),
		dependents: dependents.slice(0, 40),
		snippet,
		keyLines
	};
}
//#endregion
//#region lib/types/analyze.js
/**
* Code-first analysis for the Arch Lens backend: scans each package's entry
* source for service registrations, event listeners, Remote methods, and tool
* registrations, so the learning desk can derive architecture from CODE even
* when documentation is missing or stale. The analysis is bounded (entry
* source head only) and heuristic (regex over source text), and its results
* are explicitly "code-derived insights" — not a substitute for curated data,
* but a fallback and cross-check.
* @module @deepseek-ai/dsh-arch-lens-backend/src/analyze
*/
/** Max entry source bytes scanned per package. */
const MAX_SOURCE_BYTES = 65536;
/** Match service keys provided via ctx.provide('key') / super(ctx, 'key'). */
const PROVIDE_PATTERN = /(?:ctx\.provide\(\s*'([^']+)'|super\(\s*ctx\s*,\s*'([^']+)')/g;
/** Match event names listened via ctx.on('event', / ctx.once('event'. */
const LISTEN_PATTERN = /(?:ctx\.on(?:ce)?\(\s*'([^']+)'|@Remote\(\s*'([^']+)'\))/g;
/** Match tool names registered via tools.register / harness.registerTool / defineTool. */
const TOOL_PATTERN = /(?:\.register(?:Tool)?\(\s*(?:defineTool\(\s*)?\{\s*name\s*:\s*'([^']+)'|name\s*:\s*'([^']+)')/g;
/**
* Analyze one package's entry source for code-derived insights.
* @param fs - the filesystem service.
* @param node - package node carrying its path and file list.
* @returns the insight record (empty arrays when no entry source exists).
*/
async function analyzePackage(fs, node) {
	const entryName = node.files.includes("index.ts") ? "index.ts" : node.files.includes("index.js") ? "index.js" : void 0;
	if (entryName === void 0) return {
		id: node.id,
		provides: [],
		listens: [],
		tools: [],
		remotes: []
	};
	let head = "";
	try {
		const target = await fs.resolve(`src/${entryName}`, { cwd: node.path });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_SOURCE_BYTES) return {
			id: node.id,
			provides: [],
			listens: [],
			tools: [],
			remotes: []
		};
		head = await fs.readText(target);
	} catch {
		return {
			id: node.id,
			provides: [],
			listens: [],
			tools: [],
			remotes: []
		};
	}
	const provides = /* @__PURE__ */ new Set();
	const listens = /* @__PURE__ */ new Set();
	const remotes = /* @__PURE__ */ new Set();
	for (const match of head.matchAll(PROVIDE_PATTERN)) {
		const key = match[1] ?? match[2];
		if (key !== void 0) provides.add(key);
	}
	for (const match of head.matchAll(LISTEN_PATTERN)) {
		const event = match[1] ?? match[2];
		if (match[2] !== void 0) remotes.add(match[2]);
		if (event !== void 0) listens.add(event);
	}
	const tools = /* @__PURE__ */ new Set();
	for (const match of head.matchAll(TOOL_PATTERN)) {
		const name = match[1] ?? match[2];
		if (name !== void 0) tools.add(name);
	}
	return {
		id: node.id,
		provides: [...provides],
		listens: [...listens],
		tools: [...tools],
		remotes: [...remotes]
	};
}
/**
* Analyze every package in the graph (bounded parallel: runs over the entry
* heads only, sequential per package to keep fs usage flat).
* @param fs - the filesystem service.
* @param graph - scanned graph.
* @returns insight records for packages with any finding.
*/
async function analyzeWorkspace(fs, graph) {
	const insights = [];
	for (const node of graph.nodes) {
		const insight = await analyzePackage(fs, node);
		if (insight.provides.length > 0 || insight.listens.length > 0 || insight.tools.length > 0 || insight.remotes.length > 0) insights.push(insight);
	}
	return insights;
}
//#endregion
//#region lib/types/mermaid.js
/**
* Mermaid diagram generation from the scanned workspace graph: a dependency
* flowchart and an ER-style package relationship diagram. Both are pure
* functions of the graph so the client can render any mermaid via the generic
* renderer.
* @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
*/
/** Escape a mermaid node label. */
function label(text) {
	return text.replace(/["\\]/g, "");
}
/**
* Dependency flowchart: one node per package, one edge per dsh-* peer
* dependency, grouped by subgraph.
* @param graph - scanned graph.
* @returns mermaid flowchart source.
*/
function dependencyFlowchart(graph) {
	const lines = ["flowchart TD"];
	const byGroup = /* @__PURE__ */ new Map();
	for (const node of graph.nodes) {
		const list = byGroup.get(node.group) ?? [];
		list.push(node.id);
		byGroup.set(node.group, list);
	}
	for (const [group, ids] of byGroup) {
		lines.push(`  subgraph ${label(group)}["${label(group)}"]`);
		for (const id of ids) lines.push(`    ${id}["${label(id)}"]`);
		lines.push("  end");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	return lines.join("\n");
}
/**
* ER-style package relationship diagram: packages as entities, dsh-*
* peerDependencies as relationships. This is a package-dependency ER view —
* useful for spotting coupling between package groups.
* @param graph - scanned graph.
* @returns mermaid erDiagram source.
*/
function packageErDiagram(graph) {
	const lines = ["erDiagram"];
	const emitted = /* @__PURE__ */ new Set();
	for (const node of graph.nodes) {
		lines.push(`  ${label(node.id)} {`);
		lines.push("    string name");
		lines.push(`    string group "${label(node.group)}"`);
		lines.push("  }");
		emitted.add(node.id);
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : depends`);
	}
	return lines.join("\n");
}
//#endregion
//#region lib/types/index.js
/**
* Arch Lens backend host service: workspace graph scanning, component detail
* projection, and answer-level note recording. Read-only graph/component/notes
* methods cross to the browser via Typert Remote; note file WRITES have exactly
* one path — the session/event listener below. notePending only stages in-memory
* question metadata; it never touches the file.
* @module @deepseek-ai/dsh-arch-lens-backend
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = "ARCH-NOTES.md";
/** Per-workspace prompt configuration file in the workspace root. */
const PROMPT_CONFIG_FILE = ".arch-lens-prompts.json";
/**
* The Arch Lens backend Remote service (`ctx.archLens`).
*/
let ArchLensService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _remoteGraph_decorators;
	let _remoteRefresh_decorators;
	let _remoteComponent_decorators;
	let _remoteNotes_decorators;
	let _remoteMermaidDeps_decorators;
	let _remoteMermaidEr_decorators;
	let _remoteAnalyze_decorators;
	let _remoteNotePending_decorators;
	let _remotePromptConfig_decorators;
	let _remotePromptConfigSave_decorators;
	return class ArchLensService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			__esDecorate(this, null, _remoteGraph_decorators, {
				kind: "method",
				name: "remoteGraph",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGraph" in obj,
					get: (obj) => obj.remoteGraph
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteRefresh_decorators, {
				kind: "method",
				name: "remoteRefresh",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteRefresh" in obj,
					get: (obj) => obj.remoteRefresh
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteComponent_decorators, {
				kind: "method",
				name: "remoteComponent",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteComponent" in obj,
					get: (obj) => obj.remoteComponent
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteNotes_decorators, {
				kind: "method",
				name: "remoteNotes",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteNotes" in obj,
					get: (obj) => obj.remoteNotes
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidDeps_decorators, {
				kind: "method",
				name: "remoteMermaidDeps",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidDeps" in obj,
					get: (obj) => obj.remoteMermaidDeps
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidEr_decorators, {
				kind: "method",
				name: "remoteMermaidEr",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidEr" in obj,
					get: (obj) => obj.remoteMermaidEr
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteAnalyze_decorators, {
				kind: "method",
				name: "remoteAnalyze",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteAnalyze" in obj,
					get: (obj) => obj.remoteAnalyze
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteNotePending_decorators, {
				kind: "method",
				name: "remoteNotePending",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteNotePending" in obj,
					get: (obj) => obj.remoteNotePending
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remotePromptConfig_decorators, {
				kind: "method",
				name: "remotePromptConfig",
				static: false,
				private: false,
				access: {
					has: (obj) => "remotePromptConfig" in obj,
					get: (obj) => obj.remotePromptConfig
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remotePromptConfigSave_decorators, {
				kind: "method",
				name: "remotePromptConfigSave",
				static: false,
				private: false,
				access: {
					has: (obj) => "remotePromptConfigSave" in obj,
					get: (obj) => obj.remotePromptConfigSave
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["fs", "sandboxPolicy"];
		/** Loader validation for the optional note file name. */
		static Config = Schema.object({ notesFile: Schema.string() });
		notesFile = __runInitializers(this, _instanceExtraInitializers);
		graphCache = null;
		graphInFlight = null;
		pending = null;
		/**
		* @param ctx - host context carrying fs and sandboxPolicy.
		* @param config - optional notes file name.
		*/
		constructor(ctx, config = {}) {
			super(ctx, "archLens");
			this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE;
		}
		/** Resolve the workspace root from the session sandbox policy. */
		resolveRoot() {
			const root = this.ctx.get("sandboxPolicy")?.workspaceRoot;
			if (root === void 0) return { error: "cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)" };
			return root;
		}
		/** Scan (with cache) the workspace package tree; concurrent callers share one scan. */
		graph() {
			if (this.graphCache !== null) return Promise.resolve(this.graphCache);
			if (this.graphInFlight !== null) return this.graphInFlight;
			const root = this.resolveRoot();
			if (typeof root !== "string") return Promise.resolve(root);
			const fs = this.ctx.fs;
			this.graphInFlight = scanWorkspace(fs, root).then((result) => {
				this.graphInFlight = null;
				this.graphCache = result;
				return result;
			});
			return this.graphInFlight;
		}
		/**
		* The scanned workspace graph (cached until refresh).
		* @returns graph or error.
		*/
		async remoteGraph() {
			return this.graph();
		}
		/**
		* Invalidate the graph cache and rescan.
		* @returns the fresh graph or error.
		*/
		async remoteRefresh() {
			this.graphCache = null;
			return this.graph();
		}
		/**
		* Detail projection for one package.
		* @param request - package id.
		* @returns detail or error.
		*/
		async remoteComponent(request) {
			const graph = await this.graph();
			if ("error" in graph) return graph;
			const node = graph.nodes.find((candidate) => candidate.id === request.id);
			if (node === void 0) return { error: `unknown component: ${request.id}` };
			return componentDetail(this.ctx.fs, graph, node);
		}
		/**
		* The note file listing, newest first.
		* @returns notes listing or an error.
		*/
		async remoteNotes() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return {
				path: this.notesFile,
				entries: []
			};
			return readNotes(this.ctx.fs, root, this.notesFile);
		}
		/**
		* Mermaid dependency flowchart for the scanned graph.
		* @returns flowchart source or an error.
		*/
		async remoteMermaidDeps() {
			const graph = await this.graph();
			if ("error" in graph) return graph;
			return {
				kind: "flowchart",
				source: dependencyFlowchart(graph)
			};
		}
		/**
		* Mermaid ER diagram of package relationships for the scanned graph.
		* @returns erDiagram source or an error.
		*/
		async remoteMermaidEr() {
			const graph = await this.graph();
			if ("error" in graph) return graph;
			return {
				kind: "erDiagram",
				source: packageErDiagram(graph)
			};
		}
		/**
		* Code-derived insights: services/events/tools/remotes extracted from each
		* package's entry source. This is the "code-first" view — documentation is
		* a reference, but the analysis never depends on it.
		* @returns insight records or an error.
		*/
		async remoteAnalyze() {
			const graph = await this.graph();
			if ("error" in graph) return graph;
			return analyzeWorkspace(this.ctx.fs, graph);
		}
		/**
		* Stage question metadata for the next assistant/message answer. Memory
		* only — the file write stays exclusively on the event path below.
		* @param request - target label, question text, and calling session id.
		* @returns acknowledgement.
		*/
		async remoteNotePending(request) {
			this.pending = {
				target: request.target ?? "架构讲解",
				question: request.text ?? "",
				sessionId: request.sessionId ?? null
			};
			return { ok: true };
		}
		/**
		* Read the persisted per-workspace prompt configuration.
		* @returns the config and its storage path.
		*/
		async remotePromptConfig() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return {
				path: PROMPT_CONFIG_FILE,
				config: {}
			};
			const fs = this.ctx.fs;
			try {
				const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
				const info = await fs.stat(target);
				if (info === void 0 || info.type !== "file") return {
					path: PROMPT_CONFIG_FILE,
					config: {}
				};
				const text = await fs.readText(target);
				return {
					path: PROMPT_CONFIG_FILE,
					config: JSON.parse(text)
				};
			} catch {
				return {
					path: PROMPT_CONFIG_FILE,
					config: {}
				};
			}
		}
		/**
		* Persist the per-workspace prompt configuration.
		* @param request - config fields to store (absent fields keep their stored value).
		* @returns the stored config and its path.
		*/
		async remotePromptConfigSave(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const fs = this.ctx.fs;
			try {
				const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
				const info = await fs.stat(target);
				const existing = info !== void 0 && info.type === "file" ? JSON.parse(await fs.readText(target)) : {};
				const merged = {};
				if (request.overviewPrompt !== void 0) merged.overviewPrompt = request.overviewPrompt;
				else if (existing.overviewPrompt !== void 0) merged.overviewPrompt = existing.overviewPrompt;
				if (request.explainStyle !== void 0) merged.explainStyle = request.explainStyle;
				else if (existing.explainStyle !== void 0) merged.explainStyle = existing.explainStyle;
				await fs.writeText(target, JSON.stringify(merged, null, 2));
				return {
					path: PROMPT_CONFIG_FILE,
					config: merged
				};
			} catch (error) {
				return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/** Register the single note-write path: assistant/message events. */
		async [(_remoteGraph_decorators = [Remote("graph")], _remoteRefresh_decorators = [Remote("refresh")], _remoteComponent_decorators = [Remote("component")], _remoteNotes_decorators = [Remote("notes")], _remoteMermaidDeps_decorators = [Remote("mermaidDeps")], _remoteMermaidEr_decorators = [Remote("mermaidEr")], _remoteAnalyze_decorators = [Remote("analyze")], _remoteNotePending_decorators = [Remote("notePending")], _remotePromptConfig_decorators = [Remote("promptConfig")], _remotePromptConfigSave_decorators = [Remote("promptConfigSave")], Service.init)]() {
			this.ctx.on("session/event", (session, event) => {
				if (event.type !== "assistant/message") return;
				if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return;
				const message = event.data.message;
				let answer = "";
				for (const block of message.content) if (block.type === "text") answer += block.text;
				const staged = this.pending;
				this.pending = null;
				const root = this.resolveRoot();
				if (typeof root !== "string") return;
				appendNote(this.ctx.fs, root, {
					target: staged?.target ?? "架构讲解",
					question: staged?.question ?? "",
					answer
				}, this.notesFile);
			});
		}
	};
})();
//#endregion
export { ArchLensService, ArchLensService as default };
