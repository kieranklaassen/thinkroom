//#region src/checker.ts
/**
* Checks if the given value is an object.
*/
function isObject(value) {
	return typeof value == "object" && !!value;
}
/**
* Checks if the given value is a Map.
*/
function isMap(value) {
	return value instanceof Map;
}
/**
* Checks if the given value is a Set.
*/
function isSet(value) {
	return value instanceof Set;
}
/**
* Returns true if the given value is not null or undefined.
*/
function isNotNullish(value) {
	return value != null;
}
//#endregion
//#region src/counter.ts
/**
* A map that counts occurrences of keys.
*
* @example
* ```typescript
* // Count word occurrences
* const wordCounter = new Counter<string>()
* const words = ['apple', 'banana', 'apple', 'cherry', 'banana', 'apple']
*
* for (const word of words) {
*   wordCounter.increment(word)
* }
*
* console.log(wordCounter.get('apple'))   // 3
* console.log(wordCounter.get('banana'))  // 2
* console.log(wordCounter.get('cherry'))  // 1
* console.log(wordCounter.get('orange'))  // 0 (defaults to 0)
* ```
*
* @example
* ```typescript
* // Initialize with existing counts
* const counter = new Counter<string>([
*   ['red', 5],
*   ['blue', 3],
*   ['green', 7]
* ])
*
* counter.increment('red', 2)      // red: 5 -> 7
* counter.decrement('blue')        // blue: 3 -> 2
* counter.increment('yellow')      // yellow: 0 -> 1
*
* console.log(counter.get('red'))    // 7
* console.log(counter.get('blue'))   // 2
* console.log(counter.get('yellow')) // 1
* ```
*
* @example
* ```typescript
* // Track event frequencies
* const eventCounter = new Counter<string>()
*
* eventCounter.increment('click', 5)
* eventCounter.increment('hover', 3)
* eventCounter.increment('click', 2)
*
* // Get most common events
* const events = [...eventCounter.entries()]
*   .sort((a, b) => b[1] - a[1])
*
* console.log(events) // [['click', 7], ['hover', 3]]
* ```
*/
var Counter = class extends Map {
	constructor(iterable) {
		super(iterable);
	}
	get(key) {
		return super.get(key) ?? 0;
	}
	/**
	* Increments the count for a key by a given amount (default 1).
	*/
	increment(key, amount = 1) {
		this.set(key, this.get(key) + amount);
	}
	/**
	* Decrements the count for a key by a given amount (default 1).
	*/
	decrement(key, amount = 1) {
		this.set(key, this.get(key) - amount);
	}
}, WeakCounter = class extends WeakMap {
	constructor(entries) {
		super(entries);
	}
	get(key) {
		return super.get(key) ?? 0;
	}
	/**
	* Increments the count for a key by a given amount (default 1).
	*/
	increment(key, amount = 1) {
		this.set(key, this.get(key) + amount);
	}
	/**
	* Decrements the count for a key by a given amount (default 1).
	*/
	decrement(key, amount = 1) {
		this.set(key, this.get(key) - amount);
	}
}, DefaultMap = class extends Map {
	constructor(defaultFactory, iterable) {
		super(iterable), this.defaultFactory = defaultFactory;
	}
	get(key) {
		if (this.has(key)) return super.get(key);
		let value = this.defaultFactory();
		return this.set(key, value), value;
	}
}, DefaultWeakMap = class extends WeakMap {
	constructor(defaultFactory, entries) {
		super(entries), this.defaultFactory = defaultFactory;
	}
	get(key) {
		if (this.has(key)) return super.get(key);
		let value = this.defaultFactory();
		return this.set(key, value), value;
	}
};
//#endregion
//#region src/dom.ts
/**
* Checks if the given DOM node is an Element.
*/
function isElement(node) {
	return node.nodeType === 1;
}
/**
* Checks if the given DOM node is a Text node.
*/
function isTextNode(node) {
	return node.nodeType === 3;
}
/**
* Checks if the given DOM node is an HTMLElement.
*/
function isHTMLElement(node) {
	return isElement(node) && node.namespaceURI === "http://www.w3.org/1999/xhtml";
}
/**
* Checks if the given DOM node is an SVGElement.
*/
function isSVGElement(node) {
	return isElement(node) && node.namespaceURI === "http://www.w3.org/2000/svg";
}
/**
* Checks if the given DOM node is an MathMLElement.
*/
function isMathMLElement(node) {
	return isElement(node) && node.namespaceURI === "http://www.w3.org/1998/Math/MathML";
}
/**
* Checks if the given DOM node is a Document.
*/
function isDocument(node) {
	return node.nodeType === 9;
}
/**
* Checks if the given DOM node is a DocumentFragment.
*/
function isDocumentFragment(node) {
	return node.nodeType === 11;
}
/**
* Checks if the given DOM node is a ShadowRoot.
*/
function isShadowRoot(node) {
	return isDocumentFragment(node) && "host" in node && isElementLike(node.host);
}
/**
* Checks if an unknown value is likely a DOM node.
*/
function isNodeLike(value) {
	return isObject(value) && value.nodeType !== void 0;
}
/**
* Checks if an unknown value is likely a DOM element.
*/
function isElementLike(value) {
	return isObject(value) && value.nodeType === 1 && typeof value.nodeName == "string";
}
/**
* Checks if the given value is likely a Window object.
*/
function isWindowLike(value) {
	return isObject(value) && value.window === value;
}
/**
* Gets the window object for the given target or the global window object if no
* target is provided.
*/
function getWindow(target) {
	if (target) {
		if (isShadowRoot(target)) return getWindow(target.host);
		if (isDocument(target)) return target.defaultView || window;
		if (isElement(target)) return target.ownerDocument?.defaultView || window;
	}
	return window;
}
/**
* Gets the document for the given target or the global document if no target is
* provided.
*/
function getDocument(target) {
	return target ? isWindowLike(target) ? target.document : isDocument(target) ? target : target.ownerDocument || document : document;
}
/**
* Gets a reference to the root node of the document based on the given target.
*/
function getDocumentElement(target) {
	return getDocument(target).documentElement;
}
//#endregion
//#region src/format-bytes.ts
/**
* Formats a number of bytes into a human-readable string.
* @param bytes - The number of bytes to format.
* @returns A string representing the number of bytes in a human-readable format.
*/
function formatBytes(bytes) {
	let units = [
		"B",
		"KB",
		"MB",
		"GB"
	], unitIndex = 0, num = bytes;
	for (; Math.abs(num) >= 1024 && unitIndex < units.length - 1;) num /= 1024, unitIndex++;
	let fraction = unitIndex === 0 && num % 1 == 0 ? 0 : 1;
	return `${num.toFixed(fraction)}${units[unitIndex]}`;
}
//#endregion
//#region src/get-id.ts
let id = 0, maxSafeInteger = 2 ** 53 - 1;
/**
* Generates a unique positive integer.
*/
function getId() {
	return id++, id >= maxSafeInteger && (id = 1), id;
}
//#endregion
//#region src/is-deep-equal.ts
/**
* Whether two values are deeply equal.
*/
function isDeepEqual(a, b) {
	if (a === b) return !0;
	if (a == null || b == null) return !1;
	let aType = typeof a;
	if (aType !== typeof b) return !1;
	if (aType === "number" && Number.isNaN(a) && Number.isNaN(b)) return !0;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return !1;
		let size = a.length;
		for (let i = 0; i < size; i++) if (!isDeepEqual(a[i], b[i])) return !1;
		return !0;
	}
	if (isSet(a)) {
		if (!isSet(b) || a.size !== b.size) return !1;
		for (let value of a) if (!b.has(value)) return !1;
		return !0;
	}
	if (isMap(a)) {
		if (!isMap(b) || a.size !== b.size) return !1;
		for (let key of a.keys()) if (!b.has(key) || !isDeepEqual(a.get(key), b.get(key))) return !1;
		return !0;
	}
	if (typeof a == "object" && typeof b == "object") {
		let aKeys = Object.keys(a), bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return !1;
		for (let key of aKeys) if (!isDeepEqual(a[key], b[key])) return !1;
		return !0;
	}
	return !1;
}
//#endregion
//#region src/map-group-by.ts
/**
* @internal
*/
function mapGroupByPolyfill(items, keySelector) {
	let map = /* @__PURE__ */ new Map(), index = 0;
	for (let item of items) {
		let key = keySelector(item, index), group = map.get(key);
		group ? group.push(item) : map.set(key, [item]), index++;
	}
	return map;
}
/**
* A polyfill for the [`Map.groupBy()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/groupBy) static method.
*
* @public
*/
function mapGroupBy(items, keySelector) {
	return Map.groupBy ? Map.groupBy(items, keySelector) : mapGroupByPolyfill(items, keySelector);
}
//#endregion
//#region src/map-values.ts
/**
* Creates a new object with the same keys as the input object, but with values
* transformed by the provided callback function. Similar to `Array.prototype.map()`
* but for object values.

* @param object - The object whose values will be transformed.
* @param callback - A function that transforms each value. Receives the value and
*   its corresponding key as arguments.
* @returns A new object with the same keys but transformed values.
*
* @example
* ```typescript
* const prices = { apple: 1, banana: 2, orange: 3 }
* const doubled = mapValues(prices, (price) => price * 2)
* // Result: { apple: 2, banana: 4, orange: 6 }
* ```
*
* @example
* ```typescript
* const users = { john: 25, jane: 30, bob: 35 }
* const greetings = mapValues(users, (age, name) => `${name} is ${age} years old`)
* // Result: { john: 'john is 25 years old', jane: 'jane is 30 years old', bob: 'bob is 35 years old' }
* ```
*
* @example
* ```typescript
* const data = { a: '1', b: '2', c: '3' }
* const numbers = mapValues(data, (str) => parseInt(str, 10))
* // Result: { a: 1, b: 2, c: 3 }
* ```
*
* @public
*/
function mapValues(object, callback) {
	let result = {};
	for (let [key, value] of Object.entries(object)) result[key] = callback(value, key);
	return result;
}
//#endregion
//#region src/object-entries.ts
/**
* A type-safe wrapper around
* [`Object.entries()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries)
* that preserves the exact types of object keys and values. Unlike the standard
* `Object.entries()` which returns `[string, any][]`, this function returns an
* array of tuples where each tuple is precisely typed according to the input
* object's structure.
*
* This is particularly useful when working with objects that have known, fixed
* property types and you want to maintain type safety when iterating over
* entries.
*
* @example
* ```typescript
* const myObject = { a: 1, b: 'hello', c: true } as const
* const entries = objectEntries(myObject)
* // Type: (["a", 1] | ["b", "hello"] | ["c", true])[]
*
* for (const [key, value] of entries) {
*   // key is typed as "a" | "b" | "c"
*   // value is typed as 1 | "hello" | true
*   console.log(`${key}: ${value}`)
* }
* ```
*
* @example
* ```typescript
* interface User {
*   name: string
*   age: number
*   active: boolean
* }
*
* const user: User = { name: 'Alice', age: 30, active: true }
* const entries = objectEntries(user)
* // Type: (["name", string] | ["age", number] | ["active", boolean])[]
* ```
*
* @public
*/
function objectEntries(obj) {
	return Object.entries(obj);
}
//#endregion
//#region src/object-group-by.ts
/**
* @internal
*/
function objectGroupByPolyfill(items, keySelector) {
	let result = {}, index = 0;
	for (let item of items) {
		let key = keySelector(item, index), group = result[key];
		group ? group.push(item) : result[key] = [item], index++;
	}
	return result;
}
/**
* A polyfill for the [`Object.groupBy()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy) static method.
*
* @public
*/
function objectGroupBy(items, keySelector) {
	return Object.groupBy ? Object.groupBy(items, keySelector) : objectGroupByPolyfill(items, keySelector);
}
//#endregion
//#region src/once.ts
/**
* Creates a function that will only execute the provided function once.
* Subsequent calls will return the cached result from the first execution.
*
* @param fn The function to execute once
* @returns A function that will only execute the provided function once
* @example
* ```ts
* const getValue = once(() => expensiveOperation())
* getValue() // executes expensiveOperation
* getValue() // returns cached result
* ```
*/
function once(fn) {
	let called = !1, result;
	return () => (called || (result = fn(), called = !0, fn = void 0), result);
}
//#endregion
//#region src/regex.ts
/**
* Checks if current environment supports [regex lookbehind assertion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion).
*
* @returns `true` if the current environment supports regex lookbehind assertion, `false` otherwise.
*/
const supportsRegexLookbehind = /* @__PURE__ */ once(() => {
	try {
		return "ab".replaceAll(/* @__PURE__ */ RegExp("(?<=a)b", "g"), "c") === "ac";
	} catch {
		/* v8 ignore start */
		return !1;
	}
});
//#endregion
//#region src/sleep.ts
/**
* Returns a Promise that resolves after a specified number of milliseconds.
*
* @param ms - The number of milliseconds to wait.
*
* @example
* ```js
* await sleep(1000)  // Wait 1 second
* ```
*/
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
//#endregion
//#region src/throttle.ts
/**
* Creates a throttled function that only invokes `fn` at most once per every
* `wait` milliseconds. The first call executes immediately (leading edge).
* If called again during the wait period, the last call will be executed at
* the end of the wait period (trailing edge).
*
* @param callback The function to throttle
* @param wait The number of milliseconds to throttle invocations to
* @returns A throttled version of the function
* @example
* ```js
* const throttled = throttle((name) => console.log('called', name), 1000)
* throttled('Alice') // logs 'called Alice' immediately
* throttled('Bob') // skipped (within 1000ms)
* throttled('Charlie') // skipped (within 1000ms)
* // after 1000ms, logs 'called Charlie' again (trailing call)
* ```
*/
function throttle(callback, wait) {
	let timeoutId, lastCallTime = 0;
	return function(...args) {
		clearTimeout(timeoutId);
		let now = Date.now(), delay = wait + lastCallTime - now;
		delay <= 0 ? (lastCallTime = now, callback.apply(this, args)) : timeoutId = setTimeout(() => {
			lastCallTime = Date.now(), callback.apply(this, args);
		}, delay);
	};
}
//#endregion
export { Counter, DefaultMap, DefaultWeakMap, WeakCounter, formatBytes, getDocument, getDocumentElement, getId, getWindow, isDeepEqual, isDocument, isDocumentFragment, isElement, isElementLike, isHTMLElement, isMap, isMathMLElement, isNodeLike, isNotNullish, isObject, isSVGElement, isSet, isShadowRoot, isTextNode, isWindowLike, mapGroupBy, mapValues, objectEntries, objectGroupBy, once, sleep, supportsRegexLookbehind, throttle };
