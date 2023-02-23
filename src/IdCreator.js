export class IdCreator {

    _buf = undefined;
    _i32 = undefined;
    _i8 = undefined;
    _seq = 1;
    static _charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._";

    constructor() {
        this._buf = new ArrayBuffer(20);
        this._i32 = new Uint32Array(this._buf);
        this._i8 = new Uint8Array(this._buf);

        var hid = this.randomWord();
        var pid = this.randomWord();
        var ms = (new Date()).valueOf();
        var tsecs = ms / 1000;
        var tnsecs = 1000000 * (ms - this._tnsecs * 1000);
        this._i32[0] = hid;
        this._i32[1] = this.swap32(tsecs);
        this._i32[2] = this.swap32(tnsecs);
        this._i32[3] = pid;
        this._i32[4] = this._seq;
    }

    generate() {
        ++(this._seq);
        this._i32[4] = this.swap32(this._seq);

        var s = [];

        // As bytes...
        var b = this._i8;
        var work = 0;
        var bits = 0, pos = 19;
        for (var i = 0; i < 27; ++i) {
            if ((bits < 6) && (pos >= 0)) {
                work = work | (b[pos] << bits);
                --pos;
                bits += 8;
            }

            var v = work & 0x3F;
            s.unshift(IdCreator._charset.charAt(v));
            work = work >> 6;
            bits -= 6;
        }

        return s.join('');
    }

    swap32(val) {
        return ((val & 0xFF) << 24)
            | ((val & 0xFF00) << 8)
            | ((val >> 8) & 0xFF00)
            | ((val >> 24) & 0xFF);
    }

    randomWord() {
        if (window && window.crypto && window.crypto.getRandomValues && Uint32Array) {
            var o = new Uint32Array(1);
            window.crypto.getRandomValues(o);
            return o[0];
        } else {
            // Fall back to pseudo-random client seed.
            return Math.floor(Math.random() * Math.pow(2, 32));
        }
    }
}