/* @ts-self-types="./pillow_rs_js.d.ts" */

export class ArrayDescriptorLayout {
    static __wrap(ptr) {
        const obj = Object.create(ArrayDescriptorLayout.prototype);
        obj.__wbg_ptr = ptr;
        ArrayDescriptorLayoutFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArrayDescriptorLayoutFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_arraydescriptorlayout_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get dimensions() {
        const ret = wasm.arraydescriptorlayout_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.arraydescriptorlayout_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get mode() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.arraydescriptorlayout_mode(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    get modeReinterpretsDtype() {
        const ret = wasm.arraydescriptorlayout_modeReinterpretsDtype(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    get rawMode() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.arraydescriptorlayout_rawMode(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.arraydescriptorlayout_width(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) ArrayDescriptorLayout.prototype[Symbol.dispose] = ArrayDescriptorLayout.prototype.free;

export class Image {
    static __wrap(ptr) {
        const obj = Object.create(Image.prototype);
        obj.__wbg_ptr = ptr;
        ImageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof Image)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_image_free(ptr, 0);
    }
    /**
     * @param {Image} src
     */
    alphaComposite(src) {
        _assertClass(src, Image);
        const ret = wasm.image_alphaComposite(this.__wbg_ptr, src.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    applyTransparency() {
        const ret = wasm.image_applyTransparency(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} r
     * @returns {Image}
     */
    boxBlur(r) {
        const ret = wasm.image_boxBlur(this.__wbg_ptr, r);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    close() {
        wasm.image_close(this.__wbg_ptr);
    }
    /**
     * @param {number} size_x
     * @param {number} size_y
     * @param {number} size_z
     * @param {Float64Array} table
     * @param {number} channels
     * @param {string | null} [target_mode]
     * @returns {Image}
     */
    color3DLUT(size_x, size_y, size_z, table, channels, target_mode) {
        const ptr0 = passArrayF64ToWasm0(table, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(target_mode) ? 0 : passStringToWasm0(target_mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_color3DLUT(this.__wbg_ptr, size_x, size_y, size_z, ptr0, len0, channels, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {string} m
     * @param {string | null} [dither]
     * @returns {Image}
     */
    convert(m, dither) {
        const ptr0 = passStringToWasm0(m, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(dither) ? 0 : passStringToWasm0(dither, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_convert(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {Image}
     */
    copy() {
        const ret = wasm.image_copy(this.__wbg_ptr);
        return Image.__wrap(ret);
    }
    /**
     * @param {number} l
     * @param {number} t
     * @param {number} r
     * @param {number} b
     * @returns {Image}
     */
    crop(l, t, r, b) {
        const ret = wasm.image_crop(this.__wbg_ptr, l, t, r, b);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {Image}
     */
    draft() {
        const ret = wasm.image_draft(this.__wbg_ptr);
        return Image.__wrap(ret);
    }
    /**
     * @param {string} _m
     * @param {number} _w
     * @param {number} _h
     * @returns {Image}
     */
    draftFn(_m, _w, _h) {
        const ptr0 = passStringToWasm0(_m, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_draftFn(this.__wbg_ptr, ptr0, len0, _w, _h);
        return Image.__wrap(ret);
    }
    /**
     * @param {number} sigma
     * @returns {Image}
     */
    effectNoise(sigma) {
        const ret = wasm.image_effectNoise(this.__wbg_ptr, sigma);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} d
     * @returns {Image}
     */
    effectSpread(d) {
        const ret = wasm.image_effectSpread(this.__wbg_ptr, d);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} f
     * @returns {Image}
     */
    enhanceBrightness(f) {
        const ret = wasm.image_enhanceBrightness(this.__wbg_ptr, f);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} f
     * @returns {Image}
     */
    enhanceColor(f) {
        const ret = wasm.image_enhanceColor(this.__wbg_ptr, f);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} f
     * @returns {Image}
     */
    enhanceContrast(f) {
        const ret = wasm.image_enhanceContrast(this.__wbg_ptr, f);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} f
     * @returns {Image}
     */
    enhanceSharpness(f) {
        const ret = wasm.image_enhanceSharpness(this.__wbg_ptr, f);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {number}
     */
    entropy() {
        const ret = wasm.image_entropy(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {Uint8Array} lut
     * @returns {Image}
     */
    eval(lut) {
        const ptr0 = passArray8ToWasm0(lut, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_eval(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {string} n
     * @returns {Image}
     */
    filter(n) {
        const ptr0 = passStringToWasm0(n, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_filter(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {string} m
     * @param {number} w
     * @param {number} h
     * @param {Uint8Array} d
     * @returns {Image}
     */
    fromBytes(m, w, h, d) {
        const ptr0 = passStringToWasm0(m, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(d, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_fromBytes(this.__wbg_ptr, ptr0, len0, w, h, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} r
     * @returns {Image}
     */
    gaussianBlur(r) {
        const ret = wasm.image_gaussianBlur(this.__wbg_ptr, r);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {Image[]}
     */
    getChildImages() {
        const ret = wasm.image_getChildImages(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    getFlattenedData() {
        const ret = wasm.image_getFlattenedData(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    getbands() {
        const ret = wasm.image_getbands(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {boolean | null} [a]
     * @returns {Uint32Array}
     */
    getbbox(a) {
        const ret = wasm.image_getbbox(this.__wbg_ptr, isLikeNone(a) ? 0xFFFFFF : a ? 1 : 0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} ch
     * @returns {Image}
     */
    getchannel(ch) {
        const ret = wasm.image_getchannel(this.__wbg_ptr, ch);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} m
     * @returns {any}
     */
    getcolors(m) {
        const ret = wasm.image_getcolors(this.__wbg_ptr, m);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number | null} [b]
     * @returns {Uint8Array}
     */
    getdata(b) {
        const ret = wasm.image_getdata(this.__wbg_ptr, isLikeNone(b) ? Number.MAX_SAFE_INTEGER : (b) >> 0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {any}
     */
    getexif() {
        const ret = wasm.image_getexif(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Array<any>}
     */
    getextrema() {
        const ret = wasm.image_getextrema(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    getim() {
        const ret = wasm.image_getim(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    getpalette() {
        const ret = wasm.image_getpalette(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {Uint8Array}
     */
    getpixel(x, y) {
        const ret = wasm.image_getpixel(this.__wbg_ptr, x, y);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Array<any>}
     */
    getprojection() {
        const ret = wasm.image_getprojection(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    getxmp() {
        const ret = wasm.image_getxmp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    hasTransparencyData() {
        const ret = wasm.image_hasTransparencyData(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.image_height(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    histogram() {
        const ret = wasm.image_histogram(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {Float32Array} kernel
     * @param {number} scale
     * @param {number} offset
     * @param {number} size
     * @returns {Image}
     */
    kernelFilter(kernel, scale, offset, size) {
        const ptr0 = passArrayF32ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_kernelFilter(this.__wbg_ptr, ptr0, len0, scale, offset, size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    load() {
        const ret = wasm.image_load(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} s
     * @returns {Image}
     */
    maxFilter(s) {
        const ret = wasm.image_maxFilter(this.__wbg_ptr, s);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} s
     * @returns {Image}
     */
    medianFilter(s) {
        const ret = wasm.image_medianFilter(this.__wbg_ptr, s);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} s
     * @returns {Image}
     */
    minFilter(s) {
        const ret = wasm.image_minFilter(this.__wbg_ptr, s);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {string}
     */
    get mode() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.image_mode(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} s
     * @returns {Image}
     */
    modeFilter(s) {
        const ret = wasm.image_modeFilter(this.__wbg_ptr, s);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {string} mode
     * @param {number} w
     * @param {number} h
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    constructor(mode, w, h, r, g, b, a) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_new(ptr0, len0, w, h, r, g, b, a);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ImageFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} data
     * @returns {Image}
     */
    static open(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_open(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {string | undefined}
     */
    paletteMode() {
        const ret = wasm.image_paletteMode(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {Uint8Array | undefined}
     */
    paletteRgba() {
        const ret = wasm.image_paletteRgba(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     * @param {number} l
     * @param {number} t
     * @param {number} rt
     * @param {number} bt
     */
    pasteColor(r, g, b, a, l, t, rt, bt) {
        const ret = wasm.image_pasteColor(this.__wbg_ptr, r, g, b, a, l, t, rt, bt);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Image} src
     * @param {number} x
     * @param {number} y
     */
    pasteImage(src, x, y) {
        _assertClass(src, Image);
        const ret = wasm.image_pasteImage(this.__wbg_ptr, src.__wbg_ptr, x, y);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Image} src
     * @param {number} x
     * @param {number} y
     * @param {Image} mask
     */
    pasteImageMasked(src, x, y, mask) {
        _assertClass(src, Image);
        _assertClass(mask, Image);
        const ret = wasm.image_pasteImageMasked(this.__wbg_ptr, src.__wbg_ptr, x, y, mask.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Image} src
     * @param {number} l
     * @param {number} t
     * @param {number} r
     * @param {number} b
     */
    pasteImageRegion(src, l, t, r, b) {
        _assertClass(src, Image);
        const ret = wasm.image_pasteImageRegion(this.__wbg_ptr, src.__wbg_ptr, l, t, r, b);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Image} src
     * @param {number} l
     * @param {number} t
     * @param {number} r
     * @param {number} b
     * @param {Image} mask
     */
    pasteImageRegionMasked(src, l, t, r, b, mask) {
        _assertClass(src, Image);
        _assertClass(mask, Image);
        const ret = wasm.image_pasteImageRegionMasked(this.__wbg_ptr, src.__wbg_ptr, l, t, r, b, mask.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} luma
     * @param {number} alpha
     * @param {number} l
     * @param {number} t
     * @param {number} r
     * @param {number} b
     */
    pasteLumaAlphaRegion(luma, alpha, l, t, r, b) {
        const ret = wasm.image_pasteLumaAlphaRegion(this.__wbg_ptr, luma, alpha, l, t, r, b);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} x
     * @param {number} y
     * @param {Image} mask
     */
    pasteRgbAt(r, g, b, x, y, mask) {
        _assertClass(mask, Image);
        const ret = wasm.image_pasteRgbAt(this.__wbg_ptr, r, g, b, x, y, mask.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} value
     * @param {number} x
     * @param {number} y
     */
    pasteScalarAt(value, x, y) {
        const ret = wasm.image_pasteScalarAt(this.__wbg_ptr, value, x, y);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} value
     * @param {number} l
     * @param {number} t
     * @param {number} r
     * @param {number} b
     */
    pasteScalarRegion(value, l, t, r, b) {
        const ret = wasm.image_pasteScalarRegion(this.__wbg_ptr, value, l, t, r, b);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number | undefined}
     */
    pendingTransparencyIndex() {
        const ret = wasm.image_pendingTransparencyIndex(this.__wbg_ptr);
        return ret === 0xFFFFFF ? undefined : ret;
    }
    /**
     * @returns {Uint8Array | undefined}
     */
    pendingTransparencyTable() {
        const ret = wasm.image_pendingTransparencyTable(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @param {Uint8Array} lut
     * @returns {Image}
     */
    point(lut) {
        const ptr0 = passArray8ToWasm0(lut, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_point(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} a
     */
    putalpha(a) {
        const ret = wasm.image_putalpha(this.__wbg_ptr, a);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} d
     */
    putdata(d) {
        const ptr0 = passArray8ToWasm0(d, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_putdata(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} data
     * @param {string | null} [rawmode]
     */
    putpalette(data, rawmode) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(rawmode) ? 0 : passStringToWasm0(rawmode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_putpalette(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    putpixel(x, y, r, g, b, a) {
        const ret = wasm.image_putpixel(this.__wbg_ptr, x, y, r, g, b, a);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    putpixelRaw(x, y, r, g, b, a) {
        const ret = wasm.image_putpixelRaw(this.__wbg_ptr, x, y, r, g, b, a);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} c
     * @returns {Image}
     */
    quantize(c) {
        const ret = wasm.image_quantize(this.__wbg_ptr, c);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} s
     * @param {number} r
     * @returns {Image}
     */
    rankFilter(s, r) {
        const ret = wasm.image_rankFilter(this.__wbg_ptr, s, r);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} f
     * @returns {Image}
     */
    reduce(f) {
        const ret = wasm.image_reduce(this.__wbg_ptr, f);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} m
     * @returns {Image}
     */
    remapPalette(m) {
        const ptr0 = passArray8ToWasm0(m, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_remapPalette(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {string}
     */
    repr() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.image_repr(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} w
     * @param {number} h
     * @param {string | null} [f]
     * @returns {Image}
     */
    resize(w, h, f) {
        var ptr0 = isLikeNone(f) ? 0 : passStringToWasm0(f, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_resize(this.__wbg_ptr, w, h, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} a
     * @returns {Image}
     */
    rotate(a) {
        const ret = wasm.image_rotate(this.__wbg_ptr, a);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    save() {
        const ret = wasm.image_save(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} f
     */
    seek(f) {
        const ret = wasm.image_seek(this.__wbg_ptr, f);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {any}
     */
    show() {
        const ret = wasm.image_show(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint32Array}
     */
    size() {
        const ret = wasm.image_size(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Image[]}
     */
    split() {
        const ret = wasm.image_split(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    tell() {
        const ret = wasm.image_tell(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} w
     * @param {number} h
     */
    thumbnail(w, h) {
        const ret = wasm.image_thumbnail(this.__wbg_ptr, w, h);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    toBytes() {
        const ret = wasm.image_toBytes(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {string} encoder_name
     * @param {string[]} args
     * @returns {Uint8Array}
     */
    toBytesEncoded(encoder_name, args) {
        const ptr0 = passStringToWasm0(encoder_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(args, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_toBytesEncoded(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * @returns {Uint8Array}
     */
    tobitmap() {
        const ret = wasm.image_tobitmap(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {any}
     */
    toqimage() {
        const ret = wasm.image_toqimage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {any}
     */
    toqpixmap() {
        const ret = wasm.image_toqpixmap(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Uint32Array} sz
     * @param {Float64Array} d
     * @returns {Image}
     */
    transform(sz, d) {
        const ptr0 = passArray32ToWasm0(sz, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(d, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.image_transform(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {string} m
     * @returns {Image}
     */
    transpose(m) {
        const ptr0 = passStringToWasm0(m, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.image_transpose(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} r
     * @param {number} p
     * @param {number} t
     * @returns {Image}
     */
    unsharpMask(r, p, t) {
        const ret = wasm.image_unsharpMask(this.__wbg_ptr, r, p, t);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    verify() {
        const ret = wasm.image_verify(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.image_width(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
}
if (Symbol.dispose) Image.prototype[Symbol.dispose] = Image.prototype.free;

export class ImageChops {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageChopsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagechops_free(ptr, 0);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static add(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_add(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static addModulo(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_addModulo(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @param {number} alpha
     * @returns {Image}
     */
    static blend(a, b, alpha) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_blend(a.__wbg_ptr, b.__wbg_ptr, alpha);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @param {Image} m
     * @returns {Image}
     */
    static composite(a, b, m) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        _assertClass(m, Image);
        const ret = wasm.imagechops_composite(a.__wbg_ptr, b.__wbg_ptr, m.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} v
     * @returns {Image}
     */
    static constant(img, v) {
        _assertClass(img, Image);
        const ret = wasm.imagechops_constant(img.__wbg_ptr, v);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static darker(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_darker(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static difference(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_difference(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static duplicate(img) {
        _assertClass(img, Image);
        const ret = wasm.imagechops_duplicate(img.__wbg_ptr);
        return Image.__wrap(ret);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static hardLight(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_hardLight(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static invert(img) {
        _assertClass(img, Image);
        const ret = wasm.imagechops_invert(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static lighter(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_lighter(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static logicalAnd(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_logicalAnd(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static logicalOr(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_logicalOr(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static logicalXor(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_logicalXor(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static multiply(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_multiply(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} x
     * @param {number} y
     * @returns {Image}
     */
    static offset(img, x, y) {
        _assertClass(img, Image);
        const ret = wasm.imagechops_offset(img.__wbg_ptr, x, y);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static overlay(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_overlay(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static screen(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_screen(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static softLight(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_softLight(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static subtract(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_subtract(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} a
     * @param {Image} b
     * @returns {Image}
     */
    static subtractModulo(a, b) {
        _assertClass(a, Image);
        _assertClass(b, Image);
        const ret = wasm.imagechops_subtractModulo(a.__wbg_ptr, b.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
}
if (Symbol.dispose) ImageChops.prototype[Symbol.dispose] = ImageChops.prototype.free;

export class ImageDraw {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageDrawFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagedraw_free(ptr, 0);
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} start
     * @param {number} end
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     * @param {number | null} [width]
     */
    arc(x0, y0, x1, y1, start, end, r, g, b, a, width) {
        const ret = wasm.imagedraw_arc(this.__wbg_ptr, x0, y0, x1, y1, start, end, r, g, b, a, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {Image} bitmap
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     */
    bitmap(x, y, bitmap, fr, fg, fb, fa) {
        _assertClass(bitmap, Image);
        const ret = wasm.imagedraw_bitmap(this.__wbg_ptr, x, y, bitmap.__wbg_ptr, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} start
     * @param {number} end
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    chord(x0, y0, x1, y1, start, end, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_chord(this.__wbg_ptr, x0, y0, x1, y1, start, end, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} cx
     * @param {number} cy
     * @param {number} radius
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    circle(cx, cy, radius, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_circle(this.__wbg_ptr, cx, cy, radius, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    ellipse(x0, y0, x1, y1, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_ellipse(this.__wbg_ptr, x0, y0, x1, y1, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {Image}
     */
    get image() {
        const ret = wasm.imagedraw_image(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     * @param {number | null} [width]
     */
    line(x0, y0, x1, y1, r, g, b, a, width) {
        const ret = wasm.imagedraw_line(this.__wbg_ptr, x0, y0, x1, y1, r, g, b, a, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Image} img
     */
    constructor(img) {
        _assertClass(img, Image);
        const ret = wasm.imagedraw_new(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ImageDrawFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} start
     * @param {number} end
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    pieslice(x0, y0, x1, y1, start, end, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_pieslice(this.__wbg_ptr, x0, y0, x1, y1, start, end, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Int32Array} pts
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    point(pts, r, g, b, a) {
        const ptr0 = passArray32ToWasm0(pts, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagedraw_point(this.__wbg_ptr, ptr0, len0, r, g, b, a);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Int32Array} points
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    polygon(points, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ptr0 = passArray32ToWasm0(points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagedraw_polygon(this.__wbg_ptr, ptr0, len0, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    rectangle(x0, y0, x1, y1, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_rectangle(this.__wbg_ptr, x0, y0, x1, y1, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} radius
     * @param {number | null} [fr]
     * @param {number | null} [fg]
     * @param {number | null} [fb]
     * @param {number | null} [fa]
     * @param {number | null} [or]
     * @param {number | null} [og]
     * @param {number | null} [ob]
     * @param {number | null} [oa]
     * @param {number | null} [width]
     */
    roundedRectangle(x0, y0, x1, y1, radius, fr, fg, fb, fa, or, og, ob, oa, width) {
        const ret = wasm.imagedraw_roundedRectangle(this.__wbg_ptr, x0, y0, x1, y1, radius, isLikeNone(fr) ? 0xFFFFFF : fr, isLikeNone(fg) ? 0xFFFFFF : fg, isLikeNone(fb) ? 0xFFFFFF : fb, isLikeNone(fa) ? 0xFFFFFF : fa, isLikeNone(or) ? 0xFFFFFF : or, isLikeNone(og) ? 0xFFFFFF : og, isLikeNone(ob) ? 0xFFFFFF : ob, isLikeNone(oa) ? 0xFFFFFF : oa, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} text
     * @param {ImageFont} font
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    text(x, y, text, font, r, g, b, a) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(font, ImageFont);
        const ret = wasm.imagedraw_text(this.__wbg_ptr, x, y, ptr0, len0, font.__wbg_ptr, r, g, b, a);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) ImageDraw.prototype[Symbol.dispose] = ImageDraw.prototype.free;

export class ImageFont {
    static __wrap(ptr) {
        const obj = Object.create(ImageFont.prototype);
        obj.__wbg_ptr = ptr;
        ImageFontFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageFontFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagefont_free(ptr, 0);
    }
    /**
     * @param {number | null} [size]
     * @returns {ImageFont}
     */
    fontVariant(size) {
        const ret = wasm.imagefont_fontVariant(this.__wbg_ptr, isLikeNone(size) ? Number.MAX_SAFE_INTEGER : Math.fround(size));
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFont.__wrap(ret[0]);
    }
    /**
     * @param {string} text
     * @param {string | null} [orientation]
     * @returns {Int32Array}
     */
    getTransposedBbox(text, orientation) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(orientation) ? 0 : passStringToWasm0(orientation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getTransposedBbox(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * @param {string} text
     * @param {string | null} [orientation]
     * @returns {number}
     */
    getTransposedLength(text, orientation) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(orientation) ? 0 : passStringToWasm0(orientation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getTransposedLength(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {string} text
     * @param {string | null} [orientation]
     * @returns {ImageFontMask}
     */
    getTransposedMask(text, orientation) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(orientation) ? 0 : passStringToWasm0(orientation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getTransposedMask(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFontMask.__wrap(ret[0]);
    }
    /**
     * @returns {Array<any>}
     */
    getVariationAxes() {
        const ret = wasm.imagefont_getVariationAxes(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Array<any>}
     */
    getVariationNames() {
        const ret = wasm.imagefont_getVariationNames(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} text
     * @returns {Uint32Array}
     */
    getbbox(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getbbox(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {string} text
     * @returns {Uint8Array}
     */
    getmask(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getmask(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * @param {string} text
     * @param {number | null} [start_x]
     * @param {number | null} [start_y]
     * @returns {ImageFontMask}
     */
    getmask2(text, start_x, start_y) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_getmask2(this.__wbg_ptr, ptr0, len0, !isLikeNone(start_x), isLikeNone(start_x) ? 0 : start_x, !isLikeNone(start_y), isLikeNone(start_y) ? 0 : start_y);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFontMask.__wrap(ret[0]);
    }
    /**
     * @returns {Array<any>}
     */
    getname() {
        const ret = wasm.imagefont_getname(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} _path
     * @param {number} _size
     * @returns {ImageFont}
     */
    static load(_path, _size) {
        const ptr0 = passStringToWasm0(_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_load(ptr0, len0, _size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFont.__wrap(ret[0]);
    }
    /**
     * @returns {ImageFont}
     */
    static loadDefault() {
        const ret = wasm.imagefont_loadDefault();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFont.__wrap(ret[0]);
    }
    /**
     * @param {string} _path
     * @param {number} _size
     * @returns {ImageFont}
     */
    static loadPath(_path, _size) {
        const ptr0 = passStringToWasm0(_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_loadPath(ptr0, len0, _size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImageFont.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} data
     * @param {number} size
     */
    constructor(data, size) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_new(ptr0, len0, size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ImageFontFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Float32Array} axes
     */
    setVariationByAxes(axes) {
        const ptr0 = passArrayF32ToWasm0(axes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_setVariationByAxes(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} name
     */
    setVariationByName(name) {
        const ptr0 = passArray8ToWasm0(name, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagefont_setVariationByName(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) ImageFont.prototype[Symbol.dispose] = ImageFont.prototype.free;

export class ImageFontMask {
    static __wrap(ptr) {
        const obj = Object.create(ImageFontMask.prototype);
        obj.__wbg_ptr = ptr;
        ImageFontMaskFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageFontMaskFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagefontmask_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.imagefontmask_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get offsetX() {
        const ret = wasm.imagefontmask_offsetX(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get offsetY() {
        const ret = wasm.imagefontmask_offsetY(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    get pixels() {
        const ret = wasm.imagefontmask_pixels(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.imagefontmask_width(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) ImageFontMask.prototype[Symbol.dispose] = ImageFontMask.prototype.free;

export class ImageOps {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageOpsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imageops_free(ptr, 0);
    }
    /**
     * @param {Image} img
     * @param {number} c
     * @returns {Image}
     */
    static autocontrast(img, c) {
        _assertClass(img, Image);
        const ret = wasm.imageops_autocontrast(img.__wbg_ptr, c);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} black_r
     * @param {number} black_g
     * @param {number} black_b
     * @param {number} white_r
     * @param {number} white_g
     * @param {number} white_b
     * @returns {Image}
     */
    static colorize(img, black_r, black_g, black_b, white_r, white_g, white_b) {
        _assertClass(img, Image);
        const ret = wasm.imageops_colorize(img.__wbg_ptr, black_r, black_g, black_b, white_r, white_g, white_b);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} w
     * @param {number} h
     * @returns {Image}
     */
    static contain(img, w, h) {
        _assertClass(img, Image);
        const ret = wasm.imageops_contain(img.__wbg_ptr, w, h);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} w
     * @param {number} h
     * @returns {Image}
     */
    static cover(img, w, h) {
        _assertClass(img, Image);
        const ret = wasm.imageops_cover(img.__wbg_ptr, w, h);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} border
     * @returns {Image}
     */
    static crop(img, border) {
        _assertClass(img, Image);
        const ret = wasm.imageops_crop(img.__wbg_ptr, border);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static equalize(img) {
        _assertClass(img, Image);
        const ret = wasm.imageops_equalize(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} border
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     * @returns {Image}
     */
    static expand(img, border, r, g, b, a) {
        _assertClass(img, Image);
        const ret = wasm.imageops_expand(img.__wbg_ptr, border, r, g, b, a);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} w
     * @param {number} h
     * @returns {Image}
     */
    static fit(img, w, h) {
        _assertClass(img, Image);
        const ret = wasm.imageops_fit(img.__wbg_ptr, w, h);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static flip(img) {
        _assertClass(img, Image);
        const ret = wasm.imageops_flip(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static grayscale(img) {
        _assertClass(img, Image);
        const ret = wasm.imageops_grayscale(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static invert(img) {
        _assertClass(img, Image);
        const ret = wasm.imageops_invert(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @returns {Image}
     */
    static mirror(img) {
        _assertClass(img, Image);
        const ret = wasm.imageops_mirror(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} w
     * @param {number} h
     * @param {number | null} [r]
     * @param {number | null} [g]
     * @param {number | null} [b]
     * @param {number | null} [a]
     * @returns {Image}
     */
    static pad(img, w, h, r, g, b, a) {
        _assertClass(img, Image);
        const ret = wasm.imageops_pad(img.__wbg_ptr, w, h, isLikeNone(r) ? 0xFFFFFF : r, isLikeNone(g) ? 0xFFFFFF : g, isLikeNone(b) ? 0xFFFFFF : b, isLikeNone(a) ? 0xFFFFFF : a);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} b
     * @returns {Image}
     */
    static posterize(img, b) {
        _assertClass(img, Image);
        const ret = wasm.imageops_posterize(img.__wbg_ptr, b);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} factor
     * @returns {Image}
     */
    static scale(img, factor) {
        _assertClass(img, Image);
        const ret = wasm.imageops_scale(img.__wbg_ptr, factor);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
    /**
     * @param {Image} img
     * @param {number} t
     * @returns {Image}
     */
    static solarize(img, t) {
        _assertClass(img, Image);
        const ret = wasm.imageops_solarize(img.__wbg_ptr, t);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Image.__wrap(ret[0]);
    }
}
if (Symbol.dispose) ImageOps.prototype[Symbol.dispose] = ImageOps.prototype.free;

export class ImagePalette {
    static __wrap(ptr) {
        const obj = Object.create(ImagePalette.prototype);
        obj.__wbg_ptr = ptr;
        ImagePaletteFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImagePaletteFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagepalette_free(ptr, 0);
    }
    /**
     * @returns {ImagePalette}
     */
    copy() {
        const ret = wasm.imagepalette_copy(this.__wbg_ptr);
        return ImagePalette.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    getdata() {
        const ret = wasm.imagepalette_getdata(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} mode
     */
    constructor(mode) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imagepalette_new(ptr0, len0);
        this.__wbg_ptr = ret;
        ImagePaletteFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {any}
     */
    save() {
        const ret = wasm.imagepalette_save(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    tobytes() {
        const ret = wasm.imagepalette_tobytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) ImagePalette.prototype[Symbol.dispose] = ImagePalette.prototype.free;

export class ImageSequence {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageSequenceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagesequence_free(ptr, 0);
    }
    /**
     * @param {Image} img
     */
    constructor(img) {
        _assertClass(img, Image);
        const ret = wasm.imagesequence_new(img.__wbg_ptr);
        this.__wbg_ptr = ret;
        ImageSequenceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Image | undefined}
     */
    next() {
        const ret = wasm.imagesequence_next(this.__wbg_ptr);
        return ret === 0 ? undefined : Image.__wrap(ret);
    }
}
if (Symbol.dispose) ImageSequence.prototype[Symbol.dispose] = ImageSequence.prototype.free;

export class ImageStat {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageStatFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagestat_free(ptr, 0);
    }
    /**
     * @param {Image} img
     */
    constructor(img) {
        _assertClass(img, Image);
        const ret = wasm.imagestat_new(img.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ImageStatFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {object}
     */
    toObject() {
        const ret = wasm.imagestat_toObject(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) ImageStat.prototype[Symbol.dispose] = ImageStat.prototype.free;

/**
 * List currently active backends (priority order).
 * @returns {string[]}
 */
export function active_backends() {
    const ret = wasm.active_backends();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function addModulo(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.addModulo(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} cutoff
 * @returns {Image}
 */
export function autocontrastFn(img, cutoff) {
    _assertClass(img, Image);
    const ret = wasm.autocontrastFn(img.__wbg_ptr, cutoff);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * List backends that exist on this machine.
 * @returns {string[]}
 */
export function available_backends() {
    const ret = wasm.available_backends();
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * Check if a specific backend is active.
 * @param {string} name
 * @returns {boolean}
 */
export function backend_enabled(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.backend_enabled(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Image} a
 * @param {Image} b
 * @param {number} alpha
 * @returns {Image}
 */
export function blend(a, b, alpha) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.blend(a.__wbg_ptr, b.__wbg_ptr, alpha);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @param {Image} m
 * @returns {Image}
 */
export function composite(a, b, m) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    _assertClass(m, Image);
    const ret = wasm.composite(a.__wbg_ptr, b.__wbg_ptr, m.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} value
 * @returns {Image}
 */
export function constant(img, value) {
    _assertClass(img, Image);
    const ret = wasm.constant(img.__wbg_ptr, value);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} w
 * @param {number} h
 * @returns {Image}
 */
export function containFn(img, w, h) {
    _assertClass(img, Image);
    const ret = wasm.containFn(img.__wbg_ptr, w, h);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} w
 * @param {number} h
 * @returns {Image}
 */
export function coverFn(img, w, h) {
    _assertClass(img, Image);
    const ret = wasm.coverFn(img.__wbg_ptr, w, h);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} border
 * @returns {Image}
 */
export function cropFn(img, border) {
    _assertClass(img, Image);
    const ret = wasm.cropFn(img.__wbg_ptr, border);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function darker(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.darker(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * Deactivate a compute backend. Returns true if it was active.
 * @param {string} name
 * @returns {boolean}
 */
export function disable_backend(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.disable_backend(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} quality
 * @returns {Image}
 */
export function effectMandelbrot(w, h, x0, y0, x1, y1, quality) {
    const ret = wasm.effectMandelbrot(w, h, x0, y0, x1, y1, quality);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} sigma
 * @returns {Image}
 */
export function effectNoiseFn(width, height, sigma) {
    const ret = wasm.effectNoiseFn(width, height, sigma);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} distance
 * @returns {Image}
 */
export function effectSpreadFn(img, distance) {
    _assertClass(img, Image);
    const ret = wasm.effectSpreadFn(img.__wbg_ptr, distance);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * Activate a compute backend. Returns true if the backend exists.
 * @param {string} name
 * @returns {boolean}
 */
export function enable_backend(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.enable_backend(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Image} img
 * @returns {Image}
 */
export function equalizeFn(img) {
    _assertClass(img, Image);
    const ret = wasm.equalizeFn(img.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {Uint8Array} lut
 * @param {number} _n_bands
 * @returns {Image}
 */
export function evalFn(img, lut, _n_bands) {
    _assertClass(img, Image);
    const ptr0 = passArray8ToWasm0(lut, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.evalFn(img.__wbg_ptr, ptr0, len0, _n_bands);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Uint8Array} raw
 * @returns {number | undefined}
 */
export function exifOrientation(raw) {
    const ptr0 = passArray8ToWasm0(raw, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.exifOrientation(ptr0, len0);
    return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
}

/**
 * @param {Uint8Array} raw
 * @returns {Uint8Array}
 */
export function exifRemoveOrientation(raw) {
    const ptr0 = passArray8ToWasm0(raw, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.exifRemoveOrientation(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Image} img
 * @param {number} border
 * @param {number} fill_r
 * @param {number} fill_g
 * @param {number} fill_b
 * @param {number} fill_a
 * @returns {Image}
 */
export function expand(img, border, fill_r, fill_g, fill_b, fill_a) {
    _assertClass(img, Image);
    const ret = wasm.expand(img.__wbg_ptr, border, fill_r, fill_g, fill_b, fill_a);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} w
 * @param {number} h
 * @returns {Image}
 */
export function fitFn(img, w, h) {
    _assertClass(img, Image);
    const ret = wasm.fitFn(img.__wbg_ptr, w, h);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @returns {Image}
 */
export function flipFn(img) {
    _assertClass(img, Image);
    const ret = wasm.flipFn(img.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} color
 * @param {string} mode
 * @returns {any}
 */
export function getColor(color, mode) {
    const ptr0 = passStringToWasm0(color, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.getColor(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Image} img
 * @returns {Image}
 */
export function grayscaleFn(img) {
    _assertClass(img, Image);
    const ret = wasm.grayscaleFn(img.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function hardLight(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.hardLight(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {Image}
 */
export function imageNew(mode, w, h, r, g, b, a) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.imageNew(ptr0, len0, w, h, r, g, b, a);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} index
 * @returns {Image}
 */
export function imageNewPaletteIndex(w, h, index) {
    const ret = wasm.imageNewPaletteIndex(w, h, index);
    return Image.__wrap(ret);
}

/**
 * @param {string} _path
 * @returns {Image}
 */
export function imageOpen(_path) {
    const ptr0 = passStringToWasm0(_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.imageOpen(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function lighter(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.lighter(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @returns {Image}
 */
export function linearGradientFn(mode) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.linearGradientFn(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function logicalAnd(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.logicalAnd(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function logicalOr(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.logicalOr(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function logicalXor(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.logicalXor(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @param {Image[]} bands
 * @returns {Image}
 */
export function merge(mode, bands) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(bands, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.merge(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @param {Image[]} bands
 * @returns {Image}
 */
export function mergeFn(mode, bands) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(bands, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.mergeFn(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @returns {Image}
 */
export function mirrorFn(img) {
    _assertClass(img, Image);
    const ret = wasm.mirrorFn(img.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function multiply(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.multiply(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} xoffset
 * @param {number} yoffset
 * @returns {Image}
 */
export function offset(img, xoffset, yoffset) {
    _assertClass(img, Image);
    const ret = wasm.offset(img.__wbg_ptr, xoffset, yoffset);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Float64Array} points
 * @param {number} steps
 * @returns {Int32Array}
 */
export function outlineCurve(points, steps) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.outlineCurve(ptr0, len0, steps);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function overlay(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.overlay(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} color
 * @returns {Image}
 */
export function padFn(img, w, h, color) {
    _assertClass(img, Image);
    const ptr0 = passArray8ToWasm0(color, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.padFn(img.__wbg_ptr, w, h, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Uint8Array} palette
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number | undefined}
 */
export function paletteGetColor(palette, r, g, b) {
    const ptr0 = passArray8ToWasm0(palette, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.paletteGetColor(ptr0, len0, r, g, b);
    return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
}

/**
 * @param {Uint8Array} palette
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {string} mode
 * @returns {number}
 */
export function paletteGetColorAppend(palette, r, g, b, a, mode) {
    const ptr0 = passArray8ToWasm0(palette, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.paletteGetColorAppend(ptr0, len0, r, g, b, a, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {Uint8Array} palette
 * @param {Uint8Array} color
 * @param {string} mode
 * @returns {number}
 */
export function paletteGetColorValidate(palette, color, mode) {
    const ptr0 = passArray8ToWasm0(palette, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(color, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.paletteGetColorValidate(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {Uint8Array} palette
 * @param {string} mode
 * @returns {string}
 */
export function paletteToText(palette, mode) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(palette, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.paletteToText(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {Image} img
 * @param {number} bits
 * @returns {Image}
 */
export function posterizeFn(img, bits) {
    _assertClass(img, Image);
    const ret = wasm.posterizeFn(img.__wbg_ptr, bits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @returns {Image}
 */
export function radialGradientFn(mode) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.radialGradientFn(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Uint32Array} shape
 * @param {string} typestr
 * @param {string | null} [mode]
 * @returns {ArrayDescriptorLayout}
 */
export function resolveArrayLayout(shape, typestr, mode) {
    const ptr0 = passArray32ToWasm0(shape, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(typestr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(mode) ? 0 : passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.resolveArrayLayout(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ArrayDescriptorLayout.__wrap(ret[0]);
}

/**
 * @param {string} mode
 * @param {string | null} [hex]
 * @param {number | null} [single]
 * @param {Uint8Array | null} [rgb]
 * @param {Uint8Array | null} [rgba]
 * @param {Uint8Array | null} [la]
 * @returns {any}
 */
export function resolveNewColor(mode, hex, single, rgb, rgba, la) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(hex) ? 0 : passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(rgb) ? 0 : passArray8ToWasm0(rgb, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    var ptr3 = isLikeNone(rgba) ? 0 : passArray8ToWasm0(rgba, wasm.__wbindgen_malloc);
    var len3 = WASM_VECTOR_LEN;
    var ptr4 = isLikeNone(la) ? 0 : passArray8ToWasm0(la, wasm.__wbindgen_malloc);
    var len4 = WASM_VECTOR_LEN;
    const ret = wasm.resolveNewColor(ptr0, len0, ptr1, len1, isLikeNone(single) ? 0xFFFFFF : single, ptr2, len2, ptr3, len3, ptr4, len4);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} factor
 * @returns {Image}
 */
export function scaleFn(img, factor) {
    _assertClass(img, Image);
    const ret = wasm.scaleFn(img.__wbg_ptr, factor);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function screenFn(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.screenFn(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * Set the maximum log level shown in the browser console.
 * Levels (ascending): 0=off, 1=error, 2=warn, 3=info, 4=debug, 5=trace.
 * @param {number} level
 */
export function setLogLevel(level) {
    wasm.setLogLevel(level);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function softLight(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.softLight(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Image} img
 * @param {number} threshold
 * @returns {Image}
 */
export function solarizeFn(img, threshold) {
    _assertClass(img, Image);
    const ret = wasm.solarizeFn(img.__wbg_ptr, threshold);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * @param {Float64Array} data
 * @returns {any}
 */
export function statFromList(data) {
    const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.statFromList(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Image} a
 * @param {Image} b
 * @returns {Image}
 */
export function subtractModulo(a, b) {
    _assertClass(a, Image);
    _assertClass(b, Image);
    const ret = wasm.subtractModulo(a.__wbg_ptr, b.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_image_new: function(arg0) {
            const ret = Image.__wrap(arg0);
            return ret;
        },
        __wbg_image_unwrap: function(arg0) {
            const ret = Image.__unwrap(arg0);
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_b667d279fd5aa943: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_push_d2ae3af0c1217ae6: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_name_3bbc583faefa4193: function(arg0, arg1, arg2) {
            arg0.name = getStringFromWasm0(arg1, arg2);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./pillow_rs_js_bg.js": import0,
    };
}

const ArrayDescriptorLayoutFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_arraydescriptorlayout_free(ptr, 1));
const ImageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_image_free(ptr, 1));
const ImageChopsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagechops_free(ptr, 1));
const ImageDrawFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagedraw_free(ptr, 1));
const ImageFontFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagefont_free(ptr, 1));
const ImageFontMaskFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagefontmask_free(ptr, 1));
const ImageOpsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imageops_free(ptr, 1));
const ImagePaletteFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagepalette_free(ptr, 1));
const ImageSequenceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagesequence_free(ptr, 1));
const ImageStatFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagestat_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('pillow_rs_js_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
