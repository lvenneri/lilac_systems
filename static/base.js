"use strict";

CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
}

function genericTouchHandler(f) {
    return function (e) {
        if (e.touches.length >= 1) {
            e.touches[0].timeStamp = e.timeStamp;
            if (f(e.touches[0])) {
                e.preventDefault();
                return false;
            }
        }
    }
}

CanvasRenderingContext2D.prototype.fillEllipse = function (x, y, r) {
    this.beginPath();
    this.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
    this.fill();
}

CanvasRenderingContext2D.prototype.strokeEllipse = function (x, y, r) {
    this.beginPath();
    this.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
    this.stroke();
}

CanvasRenderingContext2D.prototype.strokeLine = function (x0, y0, x1, y1) {
    this.beginPath();
    this.lineTo(x0, y0);
    this.lineTo(x1, y1);
    this.stroke();
}


CanvasRenderingContext2D.prototype.arrow = function (x0, y0, x1, y1, w, arrw, arrh) {

    var dx = x1 - x0;
    var dy = y1 - y0;

    var l = 1.0 / Math.sqrt(dx * dx + dy * dy);
    dx *= l;
    dy *= l;

    this.beginPath();
    this.moveTo(x0 - dy * w / 2, y0 + dx * w / 2);
    this.lineTo(x1 - dy * w / 2 - dx * arrh, y1 + dx * w / 2 - dy * arrh);
    this.lineTo(x1 - dy * arrw / 2 - dx * arrh, y1 + dx * arrw / 2 - dy * arrh);
    this.lineTo(x1, y1);
    this.lineTo(x1 + dy * arrw / 2 - dx * arrh, y1 - dx * arrw / 2 - dy * arrh);
    this.lineTo(x1 + dy * w / 2 - dx * arrh, y1 - dx * w / 2 - dy * arrh);
    this.lineTo(x0 + dy * w / 2, y0 - dx * w / 2);

    this.closePath();
    return this;
}

CanvasRenderingContext2D.prototype.feather = function (w, h, l, r, t, b, tx, ty) {
    this.save();
    this.resetTransform();

    if (tx !== undefined && ty !== undefined)
        this.translate(tx, ty);

    this.globalCompositeOperation = "destination-out";

    let grd;
    let n = 8;

    if (t) {
        grd = this.createLinearGradient(0, 0, 0, t);
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            grd.addColorStop(1 - t, "rgba(0,0,0," + ((t * t * t) + 3 * (1 - t) * t * t * t) + ")");
        }


        this.fillStyle = grd;
        this.fillRect(0, 0, w, t);
    }

    if (b) {
        grd = this.createLinearGradient(0, h - b, 0, h);
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            grd.addColorStop(t, "rgba(0,0,0," + ((t * t * t) + 3 * (1 - t) * t * t * t) + ")");
        }

        this.fillStyle = grd;
        this.fillRect(0, h - b, w, h);
    }

    if (l) {
        grd = this.createLinearGradient(0, 0, l, 0);
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            grd.addColorStop(1 - t, "rgba(0,0,0," + ((t * t * t) + 3 * (1 - t) * t * t * t) + ")");
        }


        this.fillStyle = grd;
        this.fillRect(0, 0, l, h);
    }

    if (r) {
        grd = this.createLinearGradient(w - r, 0, w, 0);
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            grd.addColorStop(t, "rgba(0,0,0," + ((t * t * t) + 3 * (1 - t) * t * t * t) + ")");
        }


        this.fillStyle = grd;
        this.fillRect(w - r, 0, r, h);
    }

    this.restore();
}


/* Mat 4 */

function mat4_transpose(a) {

    var res = [a[0], a[4], a[8], a[12],
        a[1], a[5], a[9], a[13],
        a[2], a[6], a[10], a[14],
        a[3], a[7], a[11], a[15]];
    return res;
}


function mat4_mul(a, b) {
    /* 0  1  2  3
       4  5  6  7
       8  9 10 11
      12 13 14 15 */

    var res = [];
    res[0] = a[0] * b[0] + a[1] * b[4] + a[2] * b[8] + a[3] * b[12];
    res[1] = a[0] * b[1] + a[1] * b[5] + a[2] * b[9] + a[3] * b[13];
    res[2] = a[0] * b[2] + a[1] * b[6] + a[2] * b[10] + a[3] * b[14];
    res[3] = a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3] * b[15];

    res[4] = a[4] * b[0] + a[5] * b[4] + a[6] * b[8] + a[7] * b[12];
    res[5] = a[4] * b[1] + a[5] * b[5] + a[6] * b[9] + a[7] * b[13];
    res[6] = a[4] * b[2] + a[5] * b[6] + a[6] * b[10] + a[7] * b[14];
    res[7] = a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7] * b[15];

    res[8] = a[8] * b[0] + a[9] * b[4] + a[10] * b[8] + a[11] * b[12];
    res[9] = a[8] * b[1] + a[9] * b[5] + a[10] * b[9] + a[11] * b[13];
    res[10] = a[8] * b[2] + a[9] * b[6] + a[10] * b[10] + a[11] * b[14];
    res[11] = a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11] * b[15];

    res[12] = a[12] * b[0] + a[13] * b[4] + a[14] * b[8] + a[15] * b[12];
    res[13] = a[12] * b[1] + a[13] * b[5] + a[14] * b[9] + a[15] * b[13];
    res[14] = a[12] * b[2] + a[13] * b[6] + a[14] * b[10] + a[15] * b[14];
    res[15] = a[12] * b[3] + a[13] * b[7] + a[14] * b[11] + a[15] * b[15];

    return res;
}

function mat4_mul_vec3(a, b) {
    var res = [];
    res[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3];
    res[1] = a[4] * b[0] + a[5] * b[1] + a[6] * b[2] + a[7];
    res[2] = a[8] * b[0] + a[9] * b[1] + a[10] * b[2] + a[11];
    res[3] = a[12] * b[0] + a[13] * b[1] + a[14] * b[2] + a[15];

    return res;
}

function mat4_mul_vec4(a, b) {
    var res = [];
    res[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    res[1] = a[4] * b[0] + a[5] * b[1] + a[6] * b[2] + a[7] * b[3];
    res[2] = a[8] * b[0] + a[9] * b[1] + a[10] * b[2] + a[11] * b[3];
    res[3] = a[12] * b[0] + a[13] * b[1] + a[14] * b[2] + a[15] * b[3];

    return res;
}

function mat4_invert(a) {

    let out = Array(16);

    let a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3];
    let a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7];
    let a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];
    let a30 = a[12],
        a31 = a[13],
        a32 = a[14],
        a33 = a[15];
    let b00 = a00 * a11 - a01 * a10;
    let b01 = a00 * a12 - a02 * a10;
    let b02 = a00 * a13 - a03 * a10;
    let b03 = a01 * a12 - a02 * a11;
    let b04 = a01 * a13 - a03 * a11;
    let b05 = a02 * a13 - a03 * a12;
    let b06 = a20 * a31 - a21 * a30;
    let b07 = a20 * a32 - a22 * a30;
    let b08 = a20 * a33 - a23 * a30;
    let b09 = a21 * a32 - a22 * a31;
    let b10 = a21 * a33 - a23 * a31;
    let b11 = a22 * a33 - a23 * a32;
    let det =
        b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) {
        return undefined;
    }

    det = 1.0 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
}


var ident_mat4 = [1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1];


function scale_mat4(a) {
    if (a.constructor === Array) {
        return [a[0], 0, 0, 0,
            0, a[1], 0, 0,
            0, 0, a[2], 0,
            0, 0, 0, 1];
    }
    return [a, 0, 0, 0,
        0, a, 0, 0,
        0, 0, a, 0,
        0, 0, 0, 1];
}


function rot_x_mat4(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [1, 0, 0, 0,
        0, c, -s, 0,
        0, s, c, 0,
        0, 0, 0, 1];
}

function rot_y_mat4(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [c, 0, s, 0,
        0, 1, 0, 0,
        -s, 0, c, 0,
        0, 0, 0, 1];
}

function rot_z_mat4(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [c, -s, 0, 0,
        s, c, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1];
}

function translation_mat4(t) {
    return [1, 0, 0, t[0],
        0, 1, 0, t[1],
        0, 0, 1, t[2],
        0, 0, 0, 1];
}

let x_flip_mat4 = [-1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1];

let y_flip_mat4 = [1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1];

let z_flip_mat4 = [1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -1, 0,
    0, 0, 0, 1];

let x_flip_mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
let y_flip_mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];
let z_flip_mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];


function mat3_to_mat4(mat) {
    return [mat[0], mat[1], mat[2], 0,
        mat[3], mat[4], mat[5], 0,
        mat[6], mat[7], mat[8], 0,
        0, 0, 0, 1];
}


function mat4_to_mat3(mat) {
    return [mat[0], mat[1], mat[2],
        mat[4], mat[5], mat[6],
        mat[8], mat[9], mat[10]];
}


/* Mat 3 */


function mat3_invert(a) {
    var a00 = a[0],
        a01 = a[1],
        a02 = a[2];
    var a10 = a[3],
        a11 = a[4],
        a12 = a[5];
    var a20 = a[6],
        a21 = a[7],
        a22 = a[8];
    var b01 = a22 * a11 - a12 * a21;
    var b11 = -a22 * a10 + a12 * a20;
    var b21 = a21 * a10 - a11 * a20;

    var det = a00 * b01 + a01 * b11 + a02 * b21;

    if (!det) {
        return null;
    }

    det = 1.0 / det;
    var out = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;
    return out;
}

function mat3_mul(a, b) {
    /* 0 1 2
       3 4 5
       6 7 8 */

    var res = [];
    res[0] = a[0] * b[0] + a[1] * b[3] + a[2] * b[6];
    res[1] = a[0] * b[1] + a[1] * b[4] + a[2] * b[7];
    res[2] = a[0] * b[2] + a[1] * b[5] + a[2] * b[8];

    res[3] = a[3] * b[0] + a[4] * b[3] + a[5] * b[6];
    res[4] = a[3] * b[1] + a[4] * b[4] + a[5] * b[7];
    res[5] = a[3] * b[2] + a[4] * b[5] + a[5] * b[8];

    res[6] = a[6] * b[0] + a[7] * b[3] + a[8] * b[6];
    res[7] = a[6] * b[1] + a[7] * b[4] + a[8] * b[7];
    res[8] = a[6] * b[2] + a[7] * b[5] + a[8] * b[8];

    return res;
}


function mat3_mul_vec(a, b) {
    var res = [];
    res[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    res[1] = a[3] * b[0] + a[4] * b[1] + a[5] * b[2];
    res[2] = a[6] * b[0] + a[7] * b[1] + a[8] * b[2];

    return res;
}

function mat3_transpose(a) {

    var res = [a[0], a[3], a[6],
        a[1], a[4], a[7],
        a[2], a[5], a[8]];
    return res;
}


function scale_mat3(a) {
    return [a, 0, 0, 0, a, 0, 0, 0, a];
}

function rot_x_mat3(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rot_y_mat3(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rot_z_mat3(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);

    return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function rot_aa_mat3(axis, angle) {
    let c = Math.cos(angle);
    let s = Math.sin(angle);

    let x = axis[0];
    let y = axis[1];
    let z = axis[2];

    return [
        x * x * (1 - c) + c,
        x * y * (1 - c) - z * s,
        x * z * (1 - c) + y * s,

        y * x * (1 - c) + z * s,
        y * y * (1 - c) + c,
        y * z * (1 - c) - x * s,

        z * x * (1 - c) - y * s,
        z * y * (1 - c) + x * s,
        z * z * (1 - c) + c,
    ];
}




var ident_matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
var ident_mat3 = ident_matrix;

function findMaxAndIndex(arr) {
    return arr.reduce((max, current, index) => current > max.value ? {
        value: current,
        index: index
    } : max, {value: arr[0], index: 0});
}


function vec_zeros(a) {
    var r = [];
    for (var i = 0; i < a; i++)
        r.push(0);
    return r;
}

function vec_ones(a) {
    var r = [];
    for (var i = 0; i < a; i++)
        r.push(1);
    return r;
}

function vec_scalar(a, b) {
    var r = [];
    for (var i = 0; i < a; i++)
        r.push(a[i] + b);
    return r;
}


function vec_shift(a, v) {
    var r = [];
    for (var i = 0; i < a.length - 1; i++)
        r.push(a[i + 1]);
    r.push(v)
    return r;
}

function vec_add(a, b) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(a[i] + b[i]);
    return r;
}

function vec_sub(a, b) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(a[i] - b[i]);
    return r;
}

function vec_scale(a, x) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(a[i] * x);
    return r;
}

function vec_10pow(a, x) {
    // an x raised to a powers
var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(Math.pow( x,a[i]));
    return r;

}

function vec_pow(a, x) {
    // a raised to an x power
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(Math.pow(a[i], x));
    return r;
}

function vec_log10(a) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(Math.log10(a[i]));
    return r;
}

function vec_mul(a, b) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(a[i] * b[i]);
    return r;
}


function vec_dot(a, b) {
    var r = 0
    for (var i = 0; i < a.length; i++)
        r += a[i] * b[i];
    return r;
}


function vec_cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], -a[0] * b[2] + a[2] * b[0], a[0] * b[1] - a[1] * b[0]];
}

function vec_len_sq(a) {

    return vec_dot(a, a);
}

function vec_len(a) {
    var d = 0;
    for (var i = 0; i < a.length; i++)
        d += a[i] * a[i];

    return Math.sqrt(d);
}

function vec_eq(a, b) {
    for (var i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;

    return true;

}

function vec_sum(a) {
    var r = 0;
    for (var i = 0; i < a.length; i++)
        r += a[i];
    return r;
}

function vec_norm(a) {
    var d = 0;
    for (var i = 0; i < a.length; i++)
        d += a[i] * a[i];

    d = 1.0 / Math.sqrt(d);
    var r = [];
    if (d < 0.00000001) {
        for (var i = 0; i < a.length; i++)
            r.push(0);
        return r;
    }

    for (var i = 0; i < a.length; i++)
        r.push(a[i] * d);
    return r;
}

function vec_lerp(a, b, f) {
    var r = [];
    for (var i = 0; i < a.length; i++)
        r[i] = lerp(a[i], b[i], f);
    return r;
}

function lerpColor(color1, color2, factor) {
    let result = color1.slice();
    for (let i = 0; i < 4; i++) {
        result[i] = i < 3 ? Math.round(result[i] + factor * (color2[i] - color1[i])) : result[i] + factor * (color2[i] - color1[i]);
    }
    return result;
}

function histbin(bins, vals) {
    let hist = vec_zeros(bins.length);

    for (let i = 0; i < vals.length; i++) {

        for (let j = 0; j < bins.length - 1; j++) {
            if (vals[i] > bins[j] && vals[i] <= bins[j + 1]) {
                hist[j]++;
                break;
            }
        }

        // deal with first and last bins
        // if (vals[i] <= bins[0]) {
        //     hist[0]++;
        // }
        // if (vals[i] > bins[bins.length - 1]) {
        //     hist[bins.length - 1]++;
        // }
    }

    // find max value of hist
    let norm_val = vals.length ;
    if (true) {
        let max_hist = 0;
        for (let i = 0; i < hist.length; i++) {
            if (hist[i] > max_hist) {
                max_hist = hist[i];
            }
        }
        norm_val = max_hist*4;
    }


    // normalize hist
    for (let i = 0; i < hist.length; i++) {
        hist[i] = (hist[i] / norm_val).toFixed(3) ;
    }

    // vec_norm(hist);

    return hist;
}


function histbin_lethargy(bins, vals) {
    let hist = vec_zeros(bins.length);
    let lethargy = vec_zeros(bins.length);

    // stick the vals into bins and find the lethargy for each bin

    for (let i = 0; i < vals.length; i++) {

            for (let j = 0; j < bins.length - 1; j++) {
                if (vals[i] > bins[j] && vals[i] <= bins[j + 1]) {
                    hist[j]++;
                    break;
                }
            }

    }

    // find lethargy for each bin
    for (let i = 0; i < hist.length; i++) {
        lethargy[i] = bins[i+1]-bins[i];
        // divide the hist by lethargy
        // hist[i] =hist[i]/lethargy[i];
        hist[i] = Math.log10(hist[i]/lethargy[i]);
    }

    // find max value of hist
    let norm_val = vals.length ;
    if (true) {
        let max_hist = 0;
        for (let i = 0; i < hist.length; i++) {
            if (hist[i] > max_hist) {
                max_hist = hist[i];
            }
        }
        norm_val = max_hist*4;
    }
    norm_val = 15;

    // normalize hist
    for (let i = 0; i < hist.length; i++) {
        hist[i] = (hist[i] / norm_val).toFixed(3) ;
    }

    // vec_norm(hist);

    return hist;
}


function average(a) {
    var r = 0;
    for (var i = 0; i < a.length; i++)
        r += a[i];
    return r / a.length;
}

function median(a) {
    a.sort();
    return a[Math.floor(a.length / 2)];
}

function lerp(a, b, f) {
    if (f == 0)
        return a;
    else if (f == 1)
        return b;

    return a * (1 - f) + b * f;
}

function lerp_inv(a, b, f) {
    if (f<a) return 0;
    if (f>b) return 1;
    return (f-a)/(b-a);
}

function lerp_clamp(a, b, f) {
    if (f <= 0)
        return a;
    else if (f >= 1)
        return b;

    return a * (1 - f) + b * f;
}

function smooth_lerp(a, b, f) {
    if (f == 0)
        return a;
    else if (f == 1)
        return b;

    f = f * f * (3.0 - 2.0 * f);

    return a * (1 - f) + b * f;
}

function saturate(x) {
    return Math.max(0.0, Math.min(x, 1.0));
}

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}


function step(edge0, x) {
    return x > edge0 ? 1 : 0;
}

function sharp_step(edge0, edge1, x) {
    return saturate((x - edge0) / (edge1 - edge0));
}

function smooth_step(edge0, edge1, x) {
    x = sharp_step(edge0, edge1, x);
    return x * x * (3.0 - 2.0 * x);
}

function rgba255_sq_color(r, g, b, a) {
    return [(r / 255.0) * (r / 255.0) * a, (g / 255.0) * (g / 255.0) * a, (b / 255.0) * (b / 255.0) * a, a];
}

function rgba255_color(r, g, b, a) {
    return [(r / 255.0) * a, (g / 255.0) * a, (b / 255.0) * a, a];
}

function gaussian(x, mean, sigma) {
    return Math.exp(-Math.pow(x - mean, 2) / (2 * Math.pow(sigma, 2)));

}

function gaussianPiecewise(x, mean, sigma1, sigma2) {
    if (x > mean) {
        return gaussian(x, mean, sigma1);
    } else {
        return gaussian(x, mean, sigma2);
    }
}

function sampleCDFbins(CDF,edges) {

    let i = randSampleDiscrete(CDF);
    let x = randSampleUniform(edges[i],edges[i+1]);

    return x;

}

function randSampleHist(bin_edges,fs) {
    // fs is the frequency of each bin
    // bin_edges is the edges of the bins

    // first discrete select bin, then uniform sample within bin

    // find probs of each bin
    let bin_p = [];
    let bin_p_sum = 0;
    for (let i=0;i<frequency.length;i++) {
        bin_p.push(frequency[i]*(bin_edges[i+1]-bin_edges[i]));
        bin_p_sum += bin_p[i];
    }

    // normalize
    for (let i=0;i<frequency.length;i++) {
        bin_p[i] = bin_p[i]/bin_p_sum;
    }

    // create F, the CDF
    let F = [];
    F.push(bin_p[0]);
    for (let i=1;i<bin_p.length;i++) {
        F.push(F[i-1]+bin_p[i]);
    }


    // select bin
    let bin = randSampleDiscrete(bin_p);


}

function randSampleDiscrete(F) {
    // F is the cumulative distribution function
    // returns the index of the bin

    let x = Math.random();
    for (let i=0;i<F.length;i++) {
        if (x<=F[i]) {
            return i;
        }
    }
    return F.length-1;

}



function randSampleExpotential(lambda) {
    return -Math.log(1 - Math.random()) / lambda;
}

function randSamplePowerLaw(n) {
    let x = Math.random();
    return x**(1/(n+1));
}

function randSampleUniform(a,b) {
    let x = Math.random();
    return a + x*(b-a);
}

function analyticalCIE1931(w) {
    // use w, wavelengthin nm to find the CIE 1931 color matching function xBar, yBar, zBar
    // returns x,y,z in an array

    let xBar = 1.056 * gaussianPiecewise(w, 599.8, 37.4, 31.5)
        + 0.362 * gaussianPiecewise(w, 442.0, 20.0, 20.0)
        + 0.065 * gaussianPiecewise(w, 501.1, 36.0, 36.0);
    let yBar = 0.821 * gaussianPiecewise(w, 568.8, 46.9, 46.9) + 0.286 * gaussianPiecewise(w, 530.9, 27.3, 27.3);
    let zBar = 1.217 * gaussianPiecewise(w, 437.0, 20.0, 20.0) + 0.681 * gaussianPiecewise(w, 459.0, 30.0, 30.0);
    return [xBar, yBar, zBar];
}

function rgb_from_wavlength(wavelength) {
    // get x,y, and z from analyticalCIE1931
    let xyz = analyticalCIE1931(wavelength);
    let x = xyz[0];
    let y = xyz[1];
    let z = xyz[2];
    // Adjust XYZ based on the provided white point (D65)
    x = x / 0.9505;
    z = z / 1.0890;

    // Transformation matrix from XYZ to linear RGB
    let xyz_2_rgb = [
        [1.656492, -0.354851, -0.255038],
        [-0.707196, 1.655397, -0.121364],
        [0.051713, 0.036152, 1.011530]
    ];

    // Multiply the XYZ vector by the transformation matrix to get linear RGB values
    let r = xyz_2_rgb[0][0] * x + xyz_2_rgb[0][1] * y + xyz_2_rgb[0][2] * z;
    let g = xyz_2_rgb[1][0] * x + xyz_2_rgb[1][1] * y + xyz_2_rgb[1][2] * z;
    let b = xyz_2_rgb[2][0] * x + xyz_2_rgb[2][1] * y + xyz_2_rgb[2][2] * z;

    // Gamma correction function
    function gamma(u) {
        return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
    }

    // Apply gamma correction to each RGB component
    r = gamma(r);
    g = gamma(g);
    b = gamma(b);

    // Clip the values to the range [0, 1] and scale to the range [0, 255]
    r = Math.min(Math.max(Math.round(r * 255), 0), 255);
    g = Math.min(Math.max(Math.round(g * 255), 0), 255);
    b = Math.min(Math.max(Math.round(b * 255), 0), 255);


    // Return the gamma-corrected and scaled RGB values
    return [r, g, b, 1];
}

// const spectrum = [[255, 0, 0, 1], [255, 255, 0, 1], [0, 255, 0, 1], [0, 255, 255, 1], [0, 0, 255, 1], [255, 0, 255, 1], [255, 0, 0, 1]];
const colorPalettes = {
    plasma: [[12, 7, 134, 1.0], [64, 3, 156, 1.0], [106, 0, 167, 1.0], [143, 13, 163, 1.0], [176, 42, 143, 1.0], [203, 71, 119, 1.0], [224, 100, 97, 1.0], [242, 132, 75, 1.0], [252, 166, 53, 1.0], [252, 206, 37, 1.0]],
    inferno: [[51, 51, 54, 1.0], [110, 80, 57, 1.0], [120, 80, 84, 1.0], [243, 119, 25, 1.0], [251, 164, 10, 1.0], [245, 215, 69, 1.0]],
    inferno_: [[0, 0, 3, 1.0], [22, 11, 57, 1.0], [65, 9, 103, 1.0], [106, 23, 110, 1.0], [147, 37, 103, 1.0], [187, 55, 84, 1.0], [220, 80, 57, 1.0], [243, 119, 25, 1.0], [251, 164, 10, 1.0], [245, 215, 69, 1.0]],
    viridis: [[68, 1, 84, 1.0], [72, 35, 116, 1.0], [64, 67, 135, 1.0], [52, 94, 141, 1.0], [41, 120, 142, 1.0], [32, 144, 140, 1.0], [34, 167, 132, 1.0], [68, 190, 112, 1.0], [121, 209, 81, 1.0], [189, 222, 38, 1.0]],
    cor: [[49, 119, 231, 1], [255, 119, 0, 1], [247, 65, 57, 1]],
    bwr: [[0, 0, 255, 1.0], [50, 50, 255, 1.0], [102, 102, 255, 1.0], [152, 152, 255, 1.0], [204, 204, 255, 1.0], [255, 254, 254, 1.0], [255, 204, 204, 1.0], [255, 152, 152, 1.0], [255, 102, 102, 1.0], [255, 49, 49, 1.0]],
    hsv: [[255, 0, 0, 1.0], [255, 147, 0, 1.0], [208, 255, 0, 1.0], [61, 255, 0, 1.0], [0, 255, 92, 1.0], [0, 255, 245, 1.0], [0, 116, 255, 1.0], [37, 0, 255, 1.0], [184, 0, 255, 1.0], [255, 0, 171, 1.0]],
    tab10: [[31, 119, 180, 1.0], [255, 127, 14, 1.0], [44, 160, 44, 1.0], [214, 39, 40, 1.0], [148, 103, 189, 1.0], [140, 86, 75, 1.0], [227, 119, 194, 1.0], [127, 127, 127, 1.0], [188, 189, 34, 1.0], [23, 190, 207, 1.0]],
    tab20: [[31, 119, 180, 1.0], [255, 127, 14, 1.0], [44, 160, 44, 1.0], [214, 39, 40, 1.0], [148, 103, 189, 1.0], [140, 86, 75, 1.0], [227, 119, 194, 1.0], [127, 127, 127, 1.0], [188, 189, 34, 1.0], [23, 190, 207, 1.0]],
    hot: [[10, 0, 0, 1.0], [76, 0, 0, 1.0], [144, 0, 0, 1.0], [210, 0, 0, 1.0], [255, 23, 0, 1.0], [255, 91, 0, 1.0], [255, 157, 0, 1.0], [255, 225, 0, 1.0], [255, 255, 100, 1.0], [255, 255, 200, 1.0]]

};

// Function to pick a color from the spectrum
function getColorFromSpectrum(value, colorMap) {

    let colormap = colorPalettes[colorMap];
    const index = (colormap.length - 1) * value;
    const startIndex = Math.floor(index);
    const endIndex = Math.ceil(index);
    const lerpFactor = index - startIndex;

    let color = lerpColor(colormap[startIndex], colormap[endIndex], lerpFactor);
    // normalize color
    color[0] = color[0] / 255.0;
    color[1] = color[1] / 255.0;
    color[2] = color[2] / 255.0;
    return color;
    // return colormap[endIndex];
}

function rgba_color_string(rgba) {
    return "rgba(" + Math.round(saturate(rgba[0]) * 255) + "," +
        Math.round(saturate(rgba[1]) * 255) + "," +
        Math.round(saturate(rgba[2]) * 255) + "," +
        saturate(rgba[3]) + ")";
}


function calculateEnrichmentQuantities(avg_enrch, burnup_MWd_kg) {
    let tailing_enrch = .0027;
    let nattie_enrch = .007;
    let UF6_TO_U = 0.676;
    let U3O8_TO_U = 0.85;
    let lb_PER_kg = 2.20462;

    let feed_UpkgP = (avg_enrch - tailing_enrch) / (nattie_enrch - tailing_enrch);
    let SWUpkg = 1 * (1 - 2 * avg_enrch) * Math.log((1 - avg_enrch) / avg_enrch) + (feed_UpkgP - 1) * (
        1 - 2 * tailing_enrch) * Math.log((1 - tailing_enrch) / tailing_enrch) - feed_UpkgP * (
        1 - 2 * nattie_enrch) * Math.log((1 - nattie_enrch) / nattie_enrch);

    let U308pkgP = feed_UpkgP / U3O8_TO_U;
    let c_U308pkgP = 40 * lb_PER_kg * U308pkgP;
    let c_enrichment = 160.00 * SWUpkg;
    let c_conversion = 6.00 * feed_UpkgP / UF6_TO_U;
    let c_fab = 1000;
    let c_kgP = c_U308pkgP + c_enrichment + c_conversion + c_fab;

    let MWd_per_kg_U_limit = 1000; // MWd/kg
    let burnupPercent = burnup_MWd_kg / MWd_per_kg_U_limit * 100; //percent
    let burnup_kWh_kg = burnup_MWd_kg * 24 * 1e3;
    let cost_per_energy_perkWh = c_kgP / burnup_kWh_kg * 100;

    return {
        avg_enrch: avg_enrch,
        SWUpkg: SWUpkg,
        c_U308pkgP: c_U308pkgP,
        c_enrichment: c_enrichment,
        c_conversion: c_conversion,
        c_fab: c_fab,
        c_kgP: c_kgP,
        burnup_MWd_kg: burnup_MWd_kg,
        burnupPercent: burnupPercent,
        cost_per_energy_perkWh: cost_per_energy_perkWh
    };
}


function displayEnrichmentQuantities(arg0, arg1) {
    const results = calculateEnrichmentQuantities(arg0, arg1);

    document.getElementById("table_e").textContent = (results.avg_enrch * 100).toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_cat").textContent = getEnrichmentCategory(arg0);
    document.getElementById("table_cat").style["color"] = getEnrichmentCategoryColor(arg0);
    document.getElementById("table_SWU").textContent = results.SWUpkg.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_c_ore").textContent = results.c_U308pkgP.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_c_conv").textContent = results.c_conversion.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_c_enric").textContent = results.c_enrichment.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_c_fab").textContent = results.c_fab.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("table_c_total").textContent = results.c_kgP.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("burnup_MWd_kg").textContent = results.burnup_MWd_kg.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("burnup_percent").textContent = results.burnupPercent.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    document.getElementById("FuelCostperkWh").textContent = results.cost_per_energy_perkWh.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getEnrichmentCategory(arg0) {
    if (arg0 < .01) return "NATURAL";
    if (arg0 < .05) return "LEU";
    if (arg0 < .1) return "LEU+";
    if (arg0 < .2) return "HALEU";
    return "HEU";
}

function getEnrichmentCategoryColor(arg0) {
    if (arg0 < .05) return "#000"; // Replace line_col0 with the actual color value
    if (arg0 < .1) return "#317dff";
    if (arg0 < .2) return "#da6900";
    return "#ce0000";
}


function flatten(a) {
    let r = [];
    for (let i = 0; i < a.length; i++) {
        let aa = a[i];
        if (aa.constructor !== Array) {
            r.push(aa)
            continue;
        }
        for (let k = 0; k < aa.length; k++) {
            r.push(aa[k]);
        }
    }

    return r;
}

document.addEventListener("DOMContentLoaded", function () {
    if (window.bc_touch_down_state === undefined) {
        window.bc_touch_down_state = false;
        document.addEventListener("touchstart", function (e) {
            window.bc_touch_down_state = true;
        }, false);
        document.addEventListener("touchend", function (e) {
            window.bc_touch_down_state = false;
        }, false);

        document.addEventListener("touchcancel", function (e) {
            window.bc_touch_down_state = false;
        }, false);
    }




});


window.TouchHandler = function (target, begin, move, end) {


    target.onmousedown = mouse_down;
    target.ontouchstart = genericTouchHandler(mouse_down);

    var move_handler = genericTouchHandler(mouse_move);

    function mouse_down(e) {
        window.addEventListener("mousemove", mouse_move, false);
        window.addEventListener("mouseup", mouse_up, false);

        window.addEventListener("touchmove", move_handler, false);
        window.addEventListener("touchend", mouse_up, false);
        window.addEventListener("touchcancel", mouse_up, false);

        let res = begin ? begin(e) : true;

        if (res && e.preventDefault)
            e.preventDefault();
        return res;
    }

    function mouse_move(e) {
        return move ? move(e) : true;
    }

    function mouse_up(e) {
        window.removeEventListener("mousemove", mouse_move, false);
        window.removeEventListener("mouseup", mouse_up, false);

        window.removeEventListener("touchmove", move_handler, false);
        window.removeEventListener("touchend", mouse_up, false);
        window.removeEventListener("touchcancel", mouse_up, false);

        return end ? end(e) : true;
    }
}


window.Dragger = function (target, callback) {

    target.onmousedown = mouse_down;
    target.ontouchstart = genericTouchHandler(mouse_down);

    var move_handler = genericTouchHandler(mouse_move);

    var prev_mouse_x, prev_mouse_y;

    function mouse_down(e) {

        prev_mouse_x = e.clientX;
        prev_mouse_y = e.clientY;


        window.addEventListener("mousemove", mouse_move, false);
        window.addEventListener("mouseup", mouse_up, false);

        window.addEventListener("touchmove", move_handler, false);
        window.addEventListener("touchend", mouse_up, false);
        window.addEventListener("touchcancel", mouse_up, false);

        if (e.preventDefault)
            e.preventDefault();

        return true;
    }

    function mouse_move(e) {
        callback(e.clientX - prev_mouse_x, e.clientY - prev_mouse_y);

        prev_mouse_x = e.clientX;
        prev_mouse_y = e.clientY;

        return true;
    }

    function mouse_up(e) {
        window.removeEventListener("mousemove", mouse_move, false);
        window.removeEventListener("mouseup", mouse_up, false);

        window.removeEventListener("touchmove", move_handler, false);
        window.removeEventListener("touchend", mouse_up, false);
        window.removeEventListener("touchcancel", mouse_up, false);
    }
}


window.SegmentedControlVert = function (container_div, callback, values, default_option = 0) {
    var container = document.createElement("div");
    container.style.position = "relative";
    container.classList.add("segmented_control_container_vert");

    container.onclick = mouse_click;

    container_div.appendChild(container);

    var segments = [];
    var option = default_option;
    var pad = 2.0;

    for (var i = 0; i < values.length; i++) {
        var el = document.createElement("div");
        el.style.top = pad + "px";
        el.classList.add("segmented_control_off");
        el.innerHTML = values[i];
        container.appendChild(el);
        segments.push(el);
    }

    segments[option].classList.remove("segmented_control_off");
    segments[option].classList.add("segmented_control_on");

    window.addEventListener("resize", layout, true);



    layout();
    callback(option);

    this.getValue = function () {
        return values[option];
    };

    this.set_selection = function (o) {

        if (option != o) {

            segments[option].classList.remove("segmented_control_on");
            segments[option].classList.add("segmented_control_off");
            option = o;

            segments[option].classList.remove("segmented_control_off");
            segments[option].classList.add("segmented_control_on");

            callback(option);
        }
    }


    function layout() {
        var width = container_div.getBoundingClientRect().width;
        // var w = Math.floor((width - (values.length + 1) * pad) / values.length);
        var w = Math.floor((width - (values.length + 1) * pad));
        w = 300;
        // container.style.width = (w+pad*2) + "px";
        container.style.width = (w + pad * 2) + "px";
        container.style.height = ((40) * values.length + pad) + "px";

        for (var i = 0; i < values.length; i++) {
            var el = segments[i];
            el.style.top = (pad + i * 40) + "px";
            el.style.left = (pad) + "px";
            el.style.width = (w) + "px";
        }
    }

    function mouse_click(e) {

        var rect = container.getBoundingClientRect();
        // var o = e.clientX - rect.left;
        // o = Math.min(Math.max(0, Math.floor(o * values.length / rect.width)), values.length - 1);
        var o = e.clientY - rect.top;
        o = Math.min(Math.max(0, Math.floor(o * values.length / rect.height)), values.length - 1);

        if (o != option) {

            segments[option].classList.remove("segmented_control_on");
            segments[option].classList.add("segmented_control_off");
            option = o;

            segments[option].classList.remove("segmented_control_off");
            segments[option].classList.add("segmented_control_on");

            callback(option);
        }

        if (e.preventDefault)
            e.preventDefault();
        return true;
    }
}


window.SegmentedControl = function (container_div, callback, values, default_option = 0) {
    var container = document.createElement("div");
    container.style.position = "relative";


    container.classList.add("segmented_control_container");

    container.onclick = mouse_click;

    container_div.appendChild(container);

    var segments = [];
    var option = default_option;
    var pad = 2.0;

    for (var i = 0; i < values.length; i++) {
        var el = document.createElement("div");
        el.style.top = pad + "px";
        el.classList.add("segmented_control_off");
        el.innerHTML = values[i];
        container.appendChild(el);
        segments.push(el);
    }

    segments[option].classList.remove("segmented_control_off");
    segments[option].classList.add("segmented_control_on");

    window.addEventListener("resize", layout, true);


    layout();
    callback(option);
    this.getValue = function () {
        return values[option];
    };

    this.set_selection = function (o) {

        if (option != o) {

            segments[option].classList.remove("segmented_control_on");
            segments[option].classList.add("segmented_control_off");
            option = o;

            segments[option].classList.remove("segmented_control_off");
            segments[option].classList.add("segmented_control_on");

            callback(option);
        }
    }


    function layout() {
        // container_div
        var width = container.getBoundingClientRect().width;
        var w = Math.floor((width - (values.length + 1) * pad) / values.length);

        container.style.width = ((w + pad) * values.length + pad) + "px";

        for (var i = 0; i < values.length; i++) {
            var el = segments[i];
            el.style.left = (pad + (w + pad) * i) + "px";
            el.style.width = (w) + "px";
        }
    }

    function mouse_click(e) {

        var rect = container.getBoundingClientRect();
        var o = e.clientX - rect.left;
        o = Math.min(Math.max(0, Math.floor(o * values.length / rect.width)), values.length - 1);

        if (o != option) {

            segments[option].classList.remove("segmented_control_on");
            segments[option].classList.add("segmented_control_off");
            option = o;

            segments[option].classList.remove("segmented_control_off");
            segments[option].classList.add("segmented_control_on");

            callback(option);
        }

        if (e.preventDefault)
            e.preventDefault();
        return true;
    }


}


window.Clickable = function (container_div, callback, values) {
    var container = document.createElement("div");
    container.style.position = "relative";
    // container.classList.add("");

    container.onclick = mouse_click;

    // container_div.appendChild(container);

    function mouse_click(e) {
        var rect = container.getBoundingClientRect();
        var o = e.clientX - rect.left;
        return e.clientX, e.clientY;
    }


}

window.Slider = function (container_div, callback, style_prefix, default_value, disable_click) {
    var container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "0";
    container.style.position = "relative";
    container.classList.add("slider_container");
    if (style_prefix)
        container.classList.add(style_prefix + "slider_container");

    var left_gutter = document.createElement("div");
    left_gutter.classList.add("slider_left_gutter");
    if (style_prefix)
        left_gutter.classList.add(style_prefix + "slider_left_gutter");

    var right_gutter = document.createElement("div");
    right_gutter.classList.add("slider_right_gutter");
    if (style_prefix)
        right_gutter.classList.add(style_prefix + "slider_right_gutter");

    if (!disable_click) {
        left_gutter.onclick = mouse_click;
        right_gutter.onclick = mouse_click;
    }

    var knob_container = document.createElement("div");
    knob_container.style.width = "0";
    knob_container.style.height = "0";
    knob_container.style.top = "0"
    knob_container.style.position = "absolute";

    var knob = document.createElement("div");
    knob.classList.add("slider_knob");
    if (style_prefix)
        knob.classList.add(style_prefix + "slider_knob");

    knob.onmousedown = mouse_down;
    knob.ontouchstart = genericTouchHandler(mouse_down);

    container_div.appendChild(container);
    container.appendChild(left_gutter);
    container.appendChild(right_gutter);
    container.appendChild(knob_container);
    knob_container.appendChild(knob);

    window.addEventListener("resize", layout, true);

    var percentage = default_value === undefined ? 0.5 : default_value;

    layout();
    callback(percentage);

    this.set_value = function (p) {
        percentage = p;
        layout();
    }

    this.knob_div = function () {
        return knob;
    }

    function layout() {
        var width = container.getBoundingClientRect().width;
        var knobWidth = knob.getBoundingClientRect().width;

        var knobPosition = (width * percentage) - knobWidth / 2;
        knobPosition = Math.max(knobWidth/2, Math.min(width - knobWidth/2-3, knobPosition));
        knob_container.style.left = knobPosition + "px";

        left_gutter.style.width = Math.max(knobPosition,knobWidth-2) + "px";
        left_gutter.style.left = "0";


        // right_gutter.style.width = width-knobPosition- knobWidth/2 + "px";
        // right_gutter.style.left = knobPosition + "px";
        right_gutter.style.width = width- knobWidth/4 + "px";
        right_gutter.style.left = 0+ "px";

        // Constrain the knob position so it doesn't overshoot

    }

    var selection_offset;

    var move_handler = genericTouchHandler(mouse_move);

    function mouse_down(e) {

        if (window.bc_touch_down_state)
            return false;

        e == e || window.event;
        var knob_rect = knob_container.getBoundingClientRect();
        selection_offset = e.clientX - knob_rect.left - knob_rect.width/2;

        window.addEventListener("mousemove", mouse_move, false);
        window.addEventListener("mouseup", mouse_up, false);

        window.addEventListener("touchmove", move_handler, false);
        window.addEventListener("touchend", mouse_up, false);
        window.addEventListener("touchcancel", mouse_up, false);


        if (e.preventDefault)
            e.preventDefault();
        return true;
    }

    function mouse_move(e) {
        var container_rect = container.getBoundingClientRect();
        var x = e.clientX - selection_offset - container_rect.left+10;

        var p = Math.max(0, Math.min(1.0, x / container_rect.width));

        if (percentage != p) {
            percentage = p;
            layout();
            callback(p);
        }

        return true;
    }

    function mouse_up(e) {
        window.removeEventListener("mousemove", mouse_move, false);
        window.removeEventListener("mouseup", mouse_up, false);

        window.removeEventListener("touchmove", move_handler, false);
        window.removeEventListener("touchend", mouse_up, false);
        window.removeEventListener("touchcancel", mouse_up, false);
    }

    function mouse_click(e) {
        var container_rect = container.getBoundingClientRect();
        var x = e.clientX - container_rect.left;

        var p = Math.max(0, Math.min(1.0, x / container_rect.width));

        if (percentage != p) {
            percentage = p;
            layout();
            callback(p);
        }

        return true;
    }
}

window.SliderV = function (container_div, callback, style_prefix, default_value, disable_click) {
    var container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "0";
    container.style.position = "relative";
    container.classList.add("slider_container");
    if (style_prefix)
        container.classList.add(style_prefix + "slider_container");

    var left_gutter = document.createElement("div");
    left_gutter.classList.add("slider_left_gutter");
    if (style_prefix)
        left_gutter.classList.add(style_prefix + "slider_left_gutter");

    var right_gutter = document.createElement("div");
    right_gutter.classList.add("slider_right_gutter");
    if (style_prefix)
        right_gutter.classList.add(style_prefix + "slider_right_gutter");

    if (!disable_click) {
        left_gutter.onclick = mouse_click;
        right_gutter.onclick = mouse_click;
    }

    var knob_container = document.createElement("div");
    knob_container.style.width = "0";
    knob_container.style.height = "0";
    knob_container.style.top = "0"
    knob_container.style.position = "absolute";

    var knob = document.createElement("div");
    knob.classList.add("slider_knob");
    if (style_prefix)
        knob.classList.add(style_prefix + "slider_knob");

    knob.onmousedown = mouse_down;
    knob.ontouchstart = genericTouchHandler(mouse_down);

    container_div.appendChild(container);
    container.appendChild(left_gutter);
    container.appendChild(right_gutter);
    container.appendChild(knob_container);
    knob_container.appendChild(knob);

    window.addEventListener("resize", layout, true);

    var percentage = default_value === undefined ? 0.5 : default_value;

    layout();
    callback(percentage);

    this.set_value = function (p) {
        percentage = p;
        layout();
    }

    this.knob_div = function () {
        return knob;
    }

    function layout() {
        var width = container.getBoundingClientRect().width;

        left_gutter.style.width = width * percentage + "px";
        left_gutter.style.left = "0";

        right_gutter.style.width = (width * (1.0 - percentage)) + "px";
        right_gutter.style.left = width * percentage + "px";

        knob_container.style.left = (width * percentage) + "px"
    }

    var selection_offset;

    var move_handler = genericTouchHandler(mouse_move);

    function mouse_down(e) {

        if (window.bc_touch_down_state)
            return false;

        e == e || window.event;
        var knob_rect = knob_container.getBoundingClientRect();
        selection_offset = e.clientX - knob_rect.left - knob_rect.width / 2;

        window.addEventListener("mousemove", mouse_move, false);
        window.addEventListener("mouseup", mouse_up, false);

        window.addEventListener("touchmove", move_handler, false);
        window.addEventListener("touchend", mouse_up, false);
        window.addEventListener("touchcancel", mouse_up, false);


        if (e.preventDefault)
            e.preventDefault();
        return true;
    }

    function mouse_move(e) {
        var container_rect = container.getBoundingClientRect();
        var x = e.clientX - selection_offset - container_rect.left;

        var p = Math.max(0, Math.min(1.0, x / container_rect.width));

        if (percentage != p) {
            percentage = p;
            layout();
            callback(p);
        }

        return true;
    }

    function mouse_up(e) {
        window.removeEventListener("mousemove", mouse_move, false);
        window.removeEventListener("mouseup", mouse_up, false);

        window.removeEventListener("touchmove", move_handler, false);
        window.removeEventListener("touchend", mouse_up, false);
        window.removeEventListener("touchcancel", mouse_up, false);
    }

    function mouse_click(e) {
        var container_rect = container.getBoundingClientRect();
        var x = e.clientX - container_rect.left;

        var p = Math.max(0, Math.min(1.0, x / container_rect.width));

        if (percentage != p) {
            percentage = p;
            layout();
            callback(p);
        }

        return true;
    }
}

window.Shader = function (gl, vert_src, frag_src, attributes_names, uniforms_names) {

    var vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vert_src);
    gl.compileShader(vert);

    var frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, frag_src);
    gl.compileShader(frag);

    var shader = gl.createProgram();
    gl.attachShader(shader, vert);
    gl.attachShader(shader, frag);
    gl.linkProgram(shader);

    this.shader = shader;

    this.attributes = {};
    this.uniforms = {};

    if (attributes_names) {
        for (var i = 0; i < attributes_names.length; i++)
            this.attributes[attributes_names[i]] = gl.getAttribLocation(shader, attributes_names[i]);
    }

    if (uniforms_names) {
        for (var i = 0; i < uniforms_names.length; i++)
            this.uniforms[uniforms_names[i]] = gl.getUniformLocation(shader, uniforms_names[i]);
    }
}


function ArcBall(matrix, callback) {
    this.x_offset = 0;
    this.y_offset = 0;
    this.matrix = matrix ? matrix.slice() : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.callback = callback;
    this.last_timestamp = 0;
    this.last_velocity = 0;
}

ArcBall.prototype.set_viewport_size = function (width, height) {
    this.width = width;
    this.height = height;
}

ArcBall.prototype.set_viewport = function (x, y, width, height) {
    this.x_offset = x;
    this.y_offset = y;
    this.width = width;
    this.height = height;
}

ArcBall.prototype.start = function (x, y) {
    this.last_x = x;
    this.last_y = y;
    this.last_velocity = 0;

    if (this.last_request) {
        window.cancelAnimationFrame(this.last_request);
        this.last_request = 0;
    }
}

ArcBall.prototype.set_matrix = function (m) {
    this.matrix = m.slice();
    this.last_velocity = 0;

    if (this.last_request) {
        window.cancelAnimationFrame(this.last_request);
        this.last_request = 0;
    }
}

ArcBall.prototype.end = function (event_timestamp) {

    if (!this.callback)
        return;

    if (event_timestamp - this.last_timestamp > 40)
        return;

    if (this.last_velocity < 0.0001)
        return;

    let last_timestamp = 0;

    let self = this;
    let mat = this.matrix;
    let a = 0;

    function tick(timestamp) {

        if (self.last_velocity < 0.0001)
            return;

        if (last_timestamp) {
            let dt = timestamp - last_timestamp;

            while (dt-- > 0) {
                a += self.last_velocity;
                self.last_velocity *= 0.995;
            }
        }

        last_timestamp = timestamp;

        let rot = rot_aa_mat3(self.last_rotation_axis, a);

        self.matrix = mat3_mul(rot, mat);

        self.callback();

        self.last_request = window.requestAnimationFrame(tick);
    };

    this.last_request = window.requestAnimationFrame(tick);
}


ArcBall.prototype.vec = function (x, y) {

    var size = Math.min(this.width, this.height) * 0.5 * 1.3;
    var p = [(x - this.x_offset - this.width / 2) / size,
        (y - this.y_offset - this.height / 2) / size, 0];
    p[0] = -p[0];
    p[1] = -p[1];

    var d = p[0] * p[0] + p[1] * p[1];
    if (d <= 0.5) {
        p[2] = Math.sqrt(1 - d);
    } else {
        p[2] = 1 / (2 * Math.sqrt(d));
    }

    return p;
}

ArcBall.prototype.update = function (x, y, timestamp) {


    if (x == this.last_x && y == this.last_y)
        return;

    let va = this.vec(this.last_x, this.last_y);
    let vb = this.vec(x, y);

    let angle = Math.acos(Math.min(1.0, vec_dot(vec_norm(va), vec_norm(vb))));

    angle = Math.max(angle, vec_len(vec_sub(vb, va)));

    let axis = vec_norm(vec_cross(va, vb))
    let axis_len = vec_len_sq(axis);
    let dt = timestamp - this.last_timestamp;

    if (!isNaN(angle) && isFinite(angle) &&
        !isNaN(axis_len) && isFinite(axis_len) &&
        dt != 0) {


        this.matrix = mat3_mul(rot_aa_mat3(axis, angle), this.matrix);

        this.last_rotation_axis = vec_norm(vec_cross(va, vb));
        this.last_velocity = 0.8 * angle / dt;
    }

    this.last_timestamp = timestamp;
    this.last_x = x;
    this.last_y = y;
}


function TwoAxis() {
    this.angles = [0, 0];
    this.last_timestamp = 0;
    this.last_velocity = 0;
}

TwoAxis.prototype.set_size = function (size) {
    this.scale = [-2 / size[0], 2 / size[1]];
}

TwoAxis.prototype.set_callback = function (callback) {
    this.callback = callback;
}


TwoAxis.prototype.set_horizontal_limits = function (limits) {
    this.horizontal_limits = limits;
}

TwoAxis.prototype.set_vertical_limits = function (limits) {
    this.vertical_limits = limits;
}


TwoAxis.prototype.start = function (x, y) {
    this.last_position = [x, y];
    this.last_velocity = 0;

    if (this.last_request) {
        window.cancelAnimationFrame(this.last_request);
        this.last_request = 0;
    }
}

TwoAxis.prototype.set_angles = function (angles, continue_velocity) {

    this.angles = angles.slice();
    if (this.vertical_limits)
        this.angles[1] = Math.max(this.vertical_limits[0], Math.min(this.angles[1], this.vertical_limits[1]));

    if (this.horizontal_limits)
        this.angles[0] = Math.max(this.horizontal_limits[0], Math.min(this.angles[0], this.horizontal_limits[1]));

    this.matrix = mat3_mul(rot_x_mat3(this.angles[1]), rot_z_mat3(this.angles[0]));

    if (!continue_velocity) {
        this.last_velocity = 0;

        if (this.last_request) {
            window.cancelAnimationFrame(this.last_request);
            this.last_request = 0;
        }
    }
}

TwoAxis.prototype.end = function (event_timestamp) {

    if (!this.callback)
        return;

    if (event_timestamp - this.last_timestamp > 40)
        return;

    if (vec_len_sq(this.last_velocity) < 0.00000001)
        return;

    let last_timestamp = 0;

    let self = this;

    function tick(timestamp) {

        if (vec_len_sq(self.last_velocity) < 0.00000001)
            return;

        if (last_timestamp) {
            let dt = timestamp - last_timestamp;

            while (dt-- > 0) {
                self.set_angles(vec_add(self.angles, self.last_velocity), true);
                self.last_velocity = vec_scale(self.last_velocity, 0.995);
            }
        }

        last_timestamp = timestamp;

        self.callback();

        self.last_request = window.requestAnimationFrame(tick);
    };

    this.last_request = window.requestAnimationFrame(tick);
}


TwoAxis.prototype.update = function (x, y, timestamp) {

    if (x == this.last_position[0] && y == this.last_position[1])
        return;

    let position = [x, y];

    let delta = vec_mul(vec_sub(position, this.last_position), this.scale);

    this.set_angles(vec_add(this.angles, delta));

    let dt = timestamp - this.last_timestamp;

    if (dt != 0) {
        this.last_velocity = vec_scale(delta, 1 / dt);
    }

    this.last_timestamp = timestamp;
    this.last_position = position;
}


function formattedTimeHDMS(t_slide, line_col0, font_size, pw, ctx) {
    // Calculate time components from t_slide
    let tday = t_slide / 24;
    let thour = tday % 1 * 24;
    let tmin = t_slide % 1 * 60;
    let tsec = tmin % 1 * 60;

    // Set text properties and draw text on canvas
    ctx.fillStyle = line_col0;
    ctx.textAlign = "right";
    ctx.font = Math.floor(font_size * 0.8) + "px Monaco";
    ctx.fillText(tday - tday % 1 + ": " + padnum(thour, 2) + ": " + padnum(tmin, 2) + ": " + padnum(tsec, 2), pw, font_size * 3.3);
    ctx.fillText("day:hr:min:sec", pw, font_size * 4.3);
}

function formatTime(seconds, digits) {
    const units = [
        {unit: 'Byr', value: 1e9 * 60 * 60 * 24 * 365},
        {unit: 'Myr', value: 1e6 * 60 * 60 * 24 * 365},
        {unit: 'kyr', value: 1e3 * 60 * 60 * 24 * 365},
        {unit: 'yr', value: 60 * 60 * 24 * 365},
        {unit: 'day', value: 60 * 60 * 24},
        {unit: 'hr', value: 60 * 60},
        {unit: 'min', value: 60},
        {unit: 's', value: 1},
        {unit: 'ms', value: 1e-3},
        {unit: 'us', value: 1e-6},
        {unit: 'ns', value: 1e-9}
    ];

    for (const {unit, value} of units) {
        const converted = seconds / value;
        if (Math.abs(converted) >= 1) {
            return `${converted.toFixed(digits)} ${unit}`;
        }
    }

    return `${seconds} s`;
}


function formatWeight(kilograms, digits) {
    const units = [
        { unit: 't', value: 1000 },       // Metric ton
        { unit: 'kg', value: 1 },         // Kilogram
        { unit: 'g', value: 1e-3 },       // Gram
        { unit: 'mg', value: 1e-6 },       // Gram
    ];

    for (const { unit, value } of units) {
        const converted = kilograms / value;
        if (Math.abs(converted) >= 1) {
            return `${converted.toFixed(digits)} ${unit}`;
        }
    }

    return `${kilograms} kg`;
}

function padnum(num, size) {
    return ('000000000' + num.toFixed(0)).substr(-size);
}


function toUnit(quantity, baseUnit, useFullPrefix = false, digits = 0) {
    // Function to format a quantity with a metric unit
    // Arrays for metric prefixes and their full names
    const metricPrefixes = ["y", "z", "a", "f", "p", "n", "μ", "m", "", "k", "M", "G", "T", "P", "E", "Z", "Y"];
    const fullMetricPrefixes = ["yocto", "zepto", "atto", "femto", "pico", "nano", "micro", "milli", "", "kilo", "mega", "giga", "tera", "peta", "exa", "zetta", "yotta"];
    const zeroIndex = 8; // Index of the base unit (no prefix) in the metric prefixes array

    let prefixIndex = Math.floor(Math.log10(Math.abs(quantity)) / 3);
    let formattedQuantity = (quantity / 10 ** (prefixIndex * 3)).toPrecision(Math.max(digits, 3));

    // get the formattedQuantity back to number and do .toFixed(digits)
    if (digits === 0) {
        formattedQuantity = parseFloat(formattedQuantity).toFixed(digits);
    }

    // Ensure the index is within the bounds of the metric prefixes array
    let arrayIndex = Math.max(0, Math.min(prefixIndex + zeroIndex, metricPrefixes.length - 1));
    let prefix = useFullPrefix ? fullMetricPrefixes[arrayIndex] : metricPrefixes[arrayIndex];
    let formattedUnit = prefix + (prefix ? '' : '') + baseUnit;

    return [formattedQuantity, formattedUnit, formattedQuantity + ' ' + formattedUnit];
}

function formatPercent(number) {
    if (number < 1) {
        return number.toFixed(2) + '%';
    } else if (number < 100) {
        return number.toFixed(1) + '%';


    } else {
        return number.toFixed(0) + '%';
    }
}

function niceVal(quantity, digits) {
    // Function to format a quantity
    let formattedQuantity = (quantity).toPrecision(Math.max(digits, 3));

    formattedQuantity = parseFloat(formattedQuantity).toFixed(digits);
    // add commas for thousands
    formattedQuantity = formattedQuantity.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return formattedQuantity;
}


function draw_camera_axes(ctx, l, rot) {
    ctx.save();

    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    let points = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    points = points.map(p => mat3_mul_vec(rot, p));
    points = points.map(p => vec_scale(p, l));

    points[0].push("#EC5151");
    points[1].push("#55C432");
    points[2].push("#418DE2");

    points.sort((a, b) => a[2] - b[2]);

    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.strokeStyle = points[i][3];
        ctx.lineTo(0, 0);
        ctx.lineTo(points[i][0], -points[i][1]);
        ctx.stroke();

    }

    ctx.restore();
}

function compile_shader(gl, source, type) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw "could not compile shader:" + gl.getShaderInfoLog(shader);
    }

    return shader;
}

function create_program(gl, vertex, fragment) {
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw ("program filed to link:" + gl.getProgramInfoLog(program));
    }

    return program;
};


// Standard Normal variate using Box-Muller transform.
function gaussianRandom(mean = 0, stdev = 1) {
    const u = 1 - Math.random(); // Converting [0,1) to (0,1]
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Transform to the desired mean and standard deviation:
    return z * stdev + mean;
}

function poissonRandomNumber(lambda) {
    if (lambda < 10) {
        // Use direct Poisson method for smaller λ
        let L = Math.exp(-lambda);
        let k = 0;
        let p = 1;

        do {
            k++;
            p *= Math.random();
        } while (p > L);

        return k - 1;
    } else {
        // Use Normal approximation for larger λ
        let sigma = Math.sqrt(lambda);
        // let normalRandom = Math.sqrt(-2.0 * Math.log(Math.random())) * Math.cos(2.0 * Math.PI * Math.random());
        // let poissonApprox = Math.round(lambda + sigma * normalRandom);

        let poissonApprox2 = Math.round(gaussianRandom(lambda, sigma));
        // Ensure the result is not negative
        return Math.max(poissonApprox2, 0);
    }
}


function randPosSphere(radius, surface = false) {
    // random position within or on a sphere
    // random angle
    let phi = Math.random() * 2 * Math.PI;
    let costheta = Math.random() * 2 - 1;

    let theta = Math.acos(costheta);
    let r;
    if (surface) {
        r = radius;
    } else {
        let u = Math.random();
        r = radius * Math.cbrt(u);
    }
    // spherical to cartesian
    let x = r * Math.sin(theta) * Math.cos(phi);
    let y = r * Math.sin(theta) * Math.sin(phi);
    let z = r * Math.cos(theta);
    return [x, y, z];
}


function randPosCube(side, surface = false) {
    let x, y, z;
    if (surface) {
        // Randomly decide which axis will have fixed value
        const axis = Math.floor(Math.random() * 3);

        // Randomly decide if the fixed value will be positive or negative
        const sign = Math.random() < 0.5 ? -1 : 1;

        // Initialize coordinates

        // Function to generate a random coordinate within the cube's dimension
        const randomCoordinate = () => (Math.random() * 2 - 1) * side / 2;

        // Assign the fixed value to the chosen axis and random values to others
        if (axis === 0) {
            x = sign * side / 2;
            y = randomCoordinate();
            z = randomCoordinate();
        } else if (axis === 1) {
            x = randomCoordinate();
            y = sign * side / 2;
            z = randomCoordinate();
        } else {
            x = randomCoordinate();
            y = randomCoordinate();
            z = sign * side / 2;
        }


    } else {
        x = (Math.random() * 2 - 1) * side / 2;
        y = (Math.random() * 2 - 1) * side / 2;
        z = (Math.random() * 2 - 1) * side / 2;
    }
    // spherical to cartesian

    return [x, y, z];
}

function randPosCylinder(radius, height, surface = false) {
    // random angle for the circular base
    let phi = Math.random() * 2 * Math.PI;

    // random position within the height of the cylinder
    let z;
    if (surface) {
        // if on the surface, z must be either at the top or bottom
        z = Math.random() < 0.5 ? -height / 2 : height / 2;
    } else {
        // if inside, z can be anywhere within the height
        z = (Math.random() * 2 - 1) * height / 2;
    }

    let r;
    if (surface) {
        // If on the surface, restrict r to the radius
        r = radius;
    } else {
        // If inside, r can be anywhere from 0 to the radius
        r = Math.random() * radius;
    }

    // cylindrical to cartesian conversion
    let x = r * Math.cos(phi);
    let y = r * Math.sin(phi);

    return [x, y, z];
}

function sievert_ICRP_graySv_Wr(type, energy) {
    // Function to get factor to convert from gray to sv ICRP 60 table
    // energy in MeV
    if (type === "gamma" || type === "beta") {
        return 1.0;
    } else if (type === "alpha") {
        return 20;
    } else if (type === "proton") {
        return 2;
    } else if (type === "neutron") {
        if (energy < 0.025) {
            return 5.0;
        } else if (energy < 0.5) {
            return 10.0;
        } else if (energy < 2.0) {
            return 20.0;
        } else if (energy < 5.0) {
            return 10.0;
        } else {
            return 5.0;
        }
    } else {
        return 1.0;
    }
}


function findClosestIndex(arr, target) {

    // Function to find the index of the closest element in an array to a target value, ascending array
    if (arr.length === 0) return -1;

    let left = 0;
    let right = arr.length - 1;
    let closestIndex = -1;
    let closestDistance = Infinity;

    while (left <= right) {
        let mid = Math.floor((left + right) / 2);

        // Update closest element if needed
        let distance = Math.abs(arr[mid] - target);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = mid;
        }

        if (arr[mid] === target) {
            return mid; // Found the target
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return closestIndex;
}


// Functions for geometry and paths

function cubePlaneEquations(center, zRotation, sideLength) {
    const halfSide = sideLength / 2;

    // Normal vectors for each face of the cube (axis-aligned)
    let normals = [

        // each set of three defines normals defines the coordinate axis for cube
        [1, 0, 0], // Right
        [0, 1, 0], // Top
        [0, 0, 1], // Front

        [-1, 0, 0], // Left
        [0, -1, 0], // Bottom
        [0, 0, -1]  // Back
    ];

    // Rotation matrix for Z-axis rotation
    const rotationMatrix = rot_z_mat3(zRotation);

    // Apply rotation to normals
    normals = normals.map(normal => mat3_mul_vec(rotationMatrix, normal));

    // Calculate plane equations
    return normals.map(normal => {
        // const D = - (normal[0] * (center[0] + normal[0] * halfSide) +
        //              normal[1] * (center[1] + normal[1] * halfSide) +
        //              normal[2] * (center[2] + normal[2] * halfSide));

        const D = vec_dot(normal, vec_add(center, vec_scale(normal, halfSide)));


        return ["P", normal, D];
    });

}

function isPointInsideRotatedCube(point, cubeCenter, zRotation, sideLength) {
    const halfSide = sideLength / 2 * 1.01;

    // Create the inverse rotation matrix (rotate by -zRotation)
    const inverseRotationMatrix = rot_z_mat3(-zRotation);

    // Translate the point to the cube's coordinate system (make the cube's center as the origin)
    const translatedPoint = [
        point[0] - cubeCenter[0],
        point[1] - cubeCenter[1],
        point[2] - cubeCenter[2]
    ];

    // Apply the inverse rotation to the translated point
    const unrotatedPoint = mat3_mul_vec(inverseRotationMatrix, translatedPoint);

    // Check if the unrotated point lies within the bounds of the axis-aligned cube
    return Math.abs(unrotatedPoint[0]) <= halfSide &&
        Math.abs(unrotatedPoint[1]) <= halfSide &&
        Math.abs(unrotatedPoint[2]) <= halfSide;
}

function isPointInsideSphere(point, sphereCenter, radius) {
    // Check if the point is inside the sphere
    return vec_len_sq(vec_sub(point, sphereCenter)) <= radius ** 2;
}


function pmod(a, b) {
    // python modulo
    return ((a % b) + b) % b;
}

function vec_mod(vector1, vector2) {
    // element-wise modulo of two vectors
    if (vector1.length !== vector2.length) {
        throw new Error('Vectors must be of the same length');
    }

    return vector1.map((element, index) => pmod(element, vector2[index]));
}

function vec_scalar_mod(a, x) {
    // element-wise modulo of two vectors
    var r = [];
    for (var i = 0; i < a.length; i++)
        r.push(pmod(a[i], x));
    return r;
}


function logisticFunction(x, x0, k) {
    // Logistic function
    // x0 is the midpoint
    // k is the steepness
    return 1 / (1 + Math.exp(-k * (x - x0)));
}


function addDownloadButtons(targetDivId, dataObject, canvasId) {
    // Identify the target div
    const targetDiv = document.getElementById(targetDivId);
    if (!targetDiv) {
        console.error('Target div not found');
        return;
    }

    // Function to create a button if it doesn't exist
    function createButton(buttonId, buttonText, className, onClick) {
        let button = document.getElementById(buttonId);
        if (!button) {
            button = document.createElement('button');
            button.id = buttonId;
            button.textContent = buttonText;
            button.className = className;
            targetDiv.insertAdjacentElement('afterend', button);
        }
        button.onclick = onClick;
    }

    // Convert object to JSON and CSV
    const jsonData = JSON.stringify(dataObject);
    const csvData = jsonToCSV(dataObject);

    // Create or update the download JSON button
    createButton(canvasId+'downloadJsonBtn', 'Download JSON', 'downloadButton', () => downloadFile(jsonData, 'data.json'));

    // // Create or update the download CSV button
    // createButton(canvasId+'downloadCsvBtn', 'Download CSV', 'downloadButton', () => downloadFile(csvData, 'data.csv'));

    // Create or update the download WebGL screenshot button
    createButton(canvasId+'downloadWebGLBtn', 'Download PNG', 'downloadButton', () => {
        const imageSrc = captureWebGLCanvas(canvasId);
       if (imageSrc) {
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", imageSrc);
            downloadAnchorNode.setAttribute("download", "webgl-screenshot.png");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }
    });

    // Generic download function
    function downloadFile(data, filename) {
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", 'data:text/plain;charset=utf-8,' + encodeURIComponent(data));
        downloadAnchorNode.setAttribute("download", filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    // Function to convert JSON to CSV
    function jsonToCSV(json) {
        // ... existing jsonToCSV function ...
    }
}


function captureWebGLCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error('Canvas not found');
        return null;
    }
    return canvas.toDataURL(); // This will return a base64 encoded PNG image
}

function captureWebGLCanvasWithWhiteBg(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error('Canvas not found');
        return null;
    }

    // Store the current contents of the canvas
    const savedData = canvas.toDataURL();

    // Get WebGL context
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        console.error('Unable to get WebGL context');
        return null;
    }

    // Set background to white and clear
    gl.clearColor(1, 1, 1, 1); // set clear color to white
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Redraw your WebGL scene here if necessary

    // Take a screenshot with the white background
    const screenshot = canvas.toDataURL();

    // Restore the original state of the canvas
    const img = new Image();
    img.onload = function() {
        canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = savedData;

    return screenshot;
}

/**
 * makeControlPanel automatically creates control inputs (sliders, segmented controls, text inputs, and checkboxes)
 * inside the element with the given containerId.
 *
 * @param {string} containerId - The ID of the container element where controls will be added.
 * @param {Object} config - An object with arrays for each control type.
 *    Example:
 *      {
 *        sliders: [
 *          { key: "slider", label: "Slider", defaultValue: 0.5, stylePrefix: "" }
 *        ],
 *        segments: [
 *          { key: "selector", label: "Selector", options: ["option1", "option2", "option3"], defaultValue: 0 }
 *        ],
 *        textInputs: [
 *          { key: "input", label: "Input Value", defaultValue: "" },
 *          { key: "log_filename", label: "Log Filename", defaultValue: "junk.csv" }
 *        ],
 *        checkboxes: [
 *          { key: "append", label: "Append to file", defaultValue: false }
 *        ]
 *      }
 *
 * @returns {Object} An object mapping each control’s key to its created widget or DOM element.
 */
function makeControlPanel(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container with ID "${containerId}" not found.`);
      return {};
    }
  
    // Create a div for all controls and add a shared class
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "controls_container";
    container.appendChild(controlsDiv);
  
    const controls = {};
  
    // Helper function to create a control wrapper div with a label and an indicator span.
    function createControlWrapper(controlType, key, labelText) {
      const wrapper = document.createElement("div");
      wrapper.className = controlType + "_group group";
      
      if (labelText) {
        const label = document.createElement("label");
        label.textContent = labelText;
        label.className = "slider_text";
        wrapper.appendChild(label);
      }
      // Create an indicator span that will later show a check mark or an X.
      const indicator = document.createElement("span");
      indicator.className = "control-indicator";
      indicator.id = containerId + "_" + key + "_indicator";
      wrapper.appendChild(indicator);
      
      return wrapper;
    }
  
    // Create sliders
    if (config.sliders && config.sliders.length > 0) {
      const sliderGroup = document.createElement("div");
      sliderGroup.className = "";
      controlsDiv.appendChild(sliderGroup);
      config.sliders.forEach((sliderConfig, i) => {
        
        const key = sliderConfig.key;
        // Create a wrapper for this slider
        const wrapper = createControlWrapper("slider", key, sliderConfig.label);
        sliderGroup.appendChild(wrapper);

        // Also add a span to show the slider’s value
        const valueSpan = document.createElement("span");
        valueSpan.id = containerId + "_" + key + "_value";
        valueSpan.className = "indicator_value";
        wrapper.appendChild(valueSpan);
        
        // Create a container in which the custom slider widget will render.
        const sliderContainer = document.createElement("div");
        sliderContainer.id = containerId + "_" + key + "_container";
        sliderContainer.className = "slider_wrapper";

        wrapper.appendChild(sliderContainer);
     
        // Instantiate the slider from your base.js Slider class.
        // (Assume the slider callback receives a value between 0 and 1.)
        const sliderObj = new Slider(sliderContainer, function(val) {
          // Scale value to 0-100 (or you can adapt if needed).
          var scaled = (val * 100).toFixed(2);
          valueSpan.textContent = scaled;
          updateControl(key, scaled);
        }, sliderConfig.stylePrefix || "", sliderConfig.defaultValue || 0.5, false);
        sliderObj.type = "slider";
        controls[key] = sliderObj;
      });
    }
  
    // Create segmented controls
    if (config.segments && config.segments.length > 0) {
      const segmentGroup = document.createElement("div");
      segmentGroup.className = "";
      
      controlsDiv.appendChild(segmentGroup);
      config.segments.forEach((segConfig, i) => {
        const key = segConfig.key;
        const wrapper = createControlWrapper("seg", key, segConfig.label);
        segmentGroup.appendChild(wrapper);
        // For segmented controls, use your SegmentedControl constructor.
        // (Assume segConfig.options is an array of option strings.)
        const segObj = new SegmentedControl(wrapper, function(selectedIndex) {
          // Use the option value as the control value.
          const value = segConfig.options[selectedIndex];
          updateControl(key, value);
        }, segConfig.options, segConfig.defaultValue || 0);
        
        controls[key] = segObj;
        segObj.type = "segment";
        

      });

    }
  
    // Create text inputs
    if (config.textInputs && config.textInputs.length > 0) {
      const textGroup = document.createElement("div");
      textGroup.className = "";
      controlsDiv.appendChild(textGroup);
      config.textInputs.forEach((txtConfig, i) => {
        const key = txtConfig.key;
        const wrapper = createControlWrapper("text", key, txtConfig.label);
        textGroup.appendChild(wrapper);
        const inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.className = "text_input";
        inputEl.value = txtConfig.defaultValue || "";
        inputEl.id = containerId + "_" + key;
        wrapper.appendChild(inputEl);
        inputEl.addEventListener("change", function() {
          updateControl(key, inputEl.value);
        });
        controls[key] = inputEl;
      });
    }
  
    // Create checkboxes
    if (config.checkboxes && config.checkboxes.length > 0) {
      const checkboxGroup = document.createElement("div");
      checkboxGroup.className = "";
      controlsDiv.appendChild(checkboxGroup);
      config.checkboxes.forEach((chkConfig, i) => {
        const key = chkConfig.key;
        const wrapper = createControlWrapper("checkbox", key, chkConfig.label);
        checkboxGroup.appendChild(wrapper);
        const inputEl = document.createElement("input");
        inputEl.type = "checkbox";
        // inputEl.className = "text_input";
        inputEl.checked = chkConfig.defaultValue || false;
        inputEl.id = containerId + "_" + key;
        wrapper.appendChild(inputEl);
        inputEl.addEventListener("change", function() {
          updateControl(key, inputEl.checked);
        });
        controls[key] = inputEl;
      });
    }
    return controls;
  }


function updateControlIndicatorsDynamic(controls, sensorControls, containerId) {
    for (let key in sensorControls) {
      let serverVal = sensorControls[key];
      let localVal;
      let control = controls[key];
      if (!control) continue;
  

      // 1. If the control provides a getValue() method (for custom widgets)
      if (typeof control.getValue === "function") {
        localVal = control.getValue();
        // Example: if "slider" returns a fraction but the server uses 0–100, scale it.
        if (control.type === "slider" && localVal <= 1) {
          localVal = localVal * 100;
        } 

      }
      
    //   // 2. For segmented controls: check if the control object has an options array and a selectedIndex.
    //   else if (control.options && control.selectedIndex !== undefined) {
    //     localVal = control.options[control.selectedIndex];
    //   }
      // 3. If the control is an HTMLInputElement
      else if (control instanceof HTMLInputElement) {
        if (control.type === "checkbox") {
          localVal = control.checked;
        } else {
          localVal = control.value;
        }
      }
      // 4. If the control is an HTMLSelectElement
      else if (control instanceof HTMLSelectElement) {
        localVal = control.value;
      }
      // 5. Otherwise, check for a sibling display element with id: containerId + "_" + key + "_value"
      else {
        let displayEl = document.getElementById(containerId + "_" + key + "_value");
        if (displayEl) {
          localVal = displayEl.textContent;
        }
      }

      
      // Build the indicator element ID (for example, "controls_slider_indicator")
      let indicatorId = containerId + "_" + key + "_indicator";
      let indicatorEl = document.getElementById(indicatorId);
      if (indicatorEl) {
        if (localVal == serverVal) {
          indicatorEl.innerHTML = '<span class="indicator-dot match"></span>';
        } else {
          indicatorEl.innerHTML = '<span class="indicator-dot mismatch"></span>';
        }
      }
    }
}


/**
 * Dynamically build a command object from all controls and send it to the server.
 *
 * @param {Object} controls - The object returned by your dynamic control creation function.
 */
function sendCommandDynamic(controls) {
    const commandData = {};
    for (let key in controls) {
      let control = controls[key];
      let value;
      if (!control) continue;
      if (typeof control.getValue === "function") {
        value = control.getValue();
      } else if (control instanceof HTMLInputElement) {
        if (control.type === "checkbox") {
          value = control.checked;
        } else {
          value = control.value;
        }
      } else if (control instanceof HTMLSelectElement) {
        value = control.value;
      }
      commandData[key] = value;
    }
    
    fetch('/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commandData)
    })
    .then(response => response.json())
    .then(data => console.log("Command update response:", data))
    .catch(err => console.error("Error sending update:", err));
}