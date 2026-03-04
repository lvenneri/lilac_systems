let animated_drawers = [];
let models_ready = false;
let xs_ready = false;
let drawers_ready = false;
let all_drawers = [];
let all_containers = [];


(function () {
    let scale = window.devicePixelRatio || 1;
    scale = scale > 1.75 ? 2 : 1;
    const pi = Math.PI;

    let vis_decay = 0.90;
    let vis_sub = 0.03;
    let spec_n_count = 100;
    let fps = 60;
    let spf = 1 / fps;
    let c_size = 4;

    let blue_color = [49 / 255, 119 / 255, 231 / 255, 1];
    let blue_color_t = [49 / 255, 119 / 255, 231 / 255, 0];
    let fuel_color = [91 / 255, 173 / 255, 220 / 255, 1];
    let green_color = [63 / 255, 191 / 255, 21 / 255, 1];
    let yellow_color = [248 / 255, 207 / 255, 67 / 255, 1];
    let orange_color = [255 / 255, 119 / 255, 0 / 255, 1];
    let red_color = [247 / 255, 65 / 255, 57 / 255, 1];
    let gray_color = [0.8, 0.8, 0.8, 1];
    let dark_gray_color = [0.4, 0.4, 0.4, 1];
    let clip_color = [0.3, 0.3, 0.3, 1];
    let black_color = [0.1, 0.1, 0.1, 1];
    let white_color = [.8, .8, .8, 1];
    let white_color_t = [.8, .8, .8, 0];


    let target_scale = [.75, .75, 1];
    let current_scale = target_scale;


    let xs_nuke;
    let n_points;
    let points_prev;
    let points_histX;
    let points_histY;
    let points_hist_n = 10;

    let marker_styles = [
        "#3FBF15",
        "#4CA3E3",
        "#CD5353",
        "#DCCF45"
    ];

    let march_step = 17;


    function download_xs(file_path, handler) {
        let aa;
        var xhr = new XMLHttpRequest();
        xhr.open("GET", file_path);
        // xhr.responseType = "arraybuffer";

        xhr.onload = function (oEvent) {
            var buffer = xhr.response;
            if (buffer) {
                aa = handler(buffer);

            }
        };
        xhr.send();
        return aa;
    }

    function download_file(file_path, handler) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", file_path);
        xhr.responseType = "arraybuffer";

        xhr.onload = function (oEvent) {
            var buffer = xhr.response;
            if (buffer) {
                handler(buffer);
            }
        };
        xhr.send();
    }


    function padnum(num, size) {
        return ('000000000' + num.toFixed(0)).substr(-size);
    }


    function GLDrawer(scale, ready_callback) {

        let canvas = document.createElement("canvas");
        let gl = canvas.getContext('experimental-webgl');

        var asset_names = ["bounce", "noise"];

        var assets = [];
        var loaded_assets_count = 0;

        if (ready_callback) {
            var textures = [];

            for (var j = 0; j < asset_names.length; j++) {
                textures[j] = gl.createTexture();

                gl.bindTexture(gl.TEXTURE_2D, textures[j]);

                if (j == 0) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                }

                var pixel = new Uint8Array([0, 0, 0, 0]);

                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                    1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    pixel);


            }

            function asset_loaded() {
                loaded_assets_count++;

                if (loaded_assets_count == asset_names.length) {
                    for (var j = 0; j < asset_names.length; j++) {
                        gl.bindTexture(gl.TEXTURE_2D, textures[j]);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, assets[j]);

                    }

                    ready_callback();
                }
            }

            // for (var j = 0; j < asset_names.length; j++) {
            //
            //     var name = asset_names[j];
            //
            //     var image = new Image();
            //     assets[j] = image;
            //     image.onload = asset_loaded;
            //     image.src = "/images/light_shadow/" + name + ".png";
            // }
        }


        this.canvas = canvas;

        var viewport_x = 0;
        var viewport_y = 0;
        var viewport_w = 0;
        var viewport_h = 0;


        const float_size = 4;


        let basic_vertex_buffer = gl.createBuffer();
        let basic_index_buffer = gl.createBuffer();

        let sphere_index_offset = 0;
        let sphere_index_count = 0;

        let cube_index_offset = 0;
        let cube_index_count = 0;

        let cone_index_offset = 0;
        let cone_index_count = 0;

        let curve_index_offset = 0;
        let curve_index_count = 0;

        let segment_index_offset = 0;
        let segment_index_count = 0;

        let quad_index_offset = 0;
        let quad_index_count = 0;

        {
            let vertices = [];
            let indices = [];

            sphere_index_offset = indices.length;

            {
                let n = 24;

                let permute = [
                    [0, 1, 2],
                    [1, 2, 0],
                    [2, 0, 1]
                ];

                for (let w = 0; w < 6; w++) {
                    let off = vertices.length / 6;
                    let sign = ((w & 1) ? -1 : 1);
                    for (let j = 0; j <= n; j++) {

                        let s = j / n - 0.5;

                        for (let i = 0; i <= n; i++) {

                            let t = i / n - 0.5;

                            let p = [0, 0, 0];
                            p[permute[w >> 1][0]] = s * sign;
                            p[permute[w >> 1][1]] = t;
                            p[permute[w >> 1][2]] = 0.5 * sign;

                            p = vec_norm(p);

                            vertices.push(p[0]);
                            vertices.push(p[1]);
                            vertices.push(p[2]);

                            vertices.push(p[0]);
                            vertices.push(p[1]);
                            vertices.push(p[2]);
                        }
                    }

                    for (let i = 0; i < n; i++) {
                        for (let j = 0; j < n; j++) {

                            indices.push(off + j * (n + 1) + i);
                            indices.push(off + j * (n + 1) + i + n + 2);
                            indices.push(off + j * (n + 1) + i + 1);


                            indices.push(off + j * (n + 1) + i);
                            indices.push(off + j * (n + 1) + i + n + 1);
                            indices.push(off + j * (n + 1) + i + n + 2);
                        }
                    }
                }
            }

            sphere_index_count = indices.length - sphere_index_offset;

            cube_index_offset = indices.length;
            {
                let n = 1;

                let permute = [
                    [0, 1, 2],
                    [1, 2, 0],
                    [2, 0, 1]
                ];

                for (let w = 0; w < 6; w++) {
                    let off = vertices.length / 6;
                    let sign = ((w & 1) ? -1 : 1);
                    for (let j = 0; j <= n; j++) {

                        let s = j / n - 0.5;

                        for (let i = 0; i <= n; i++) {

                            let t = i / n - 0.5;

                            let p = [0, 0, 0];
                            p[permute[w >> 1][0]] = s * sign;
                            p[permute[w >> 1][1]] = t;
                            p[permute[w >> 1][2]] = 0.5 * sign;

                            let q = [0, 0, 0];
                            q[permute[w >> 1][0]] = 0;
                            q[permute[w >> 1][1]] = 0;
                            q[permute[w >> 1][2]] = sign;

                            vertices.push(p[0]);
                            vertices.push(p[1]);
                            vertices.push(p[2]);

                            vertices.push(q[0]);
                            vertices.push(q[1]);
                            vertices.push(q[2]);
                        }
                    }

                    for (let i = 0; i < n; i++) {
                        for (let j = 0; j < n; j++) {

                            indices.push(off + j * (n + 1) + i);
                            indices.push(off + j * (n + 1) + i + n + 2);
                            indices.push(off + j * (n + 1) + i + 1);


                            indices.push(off + j * (n + 1) + i);
                            indices.push(off + j * (n + 1) + i + n + 1);
                            indices.push(off + j * (n + 1) + i + n + 2);
                        }
                    }
                }
            }


            cube_index_count = indices.length - cube_index_offset;


            cone_index_offset = indices.length;

            {
                let n = 64;
                let m = 2;

                let off = vertices.length / 6;

                for (let j = 0; j <= n; j++) {

                    let a = 2 * pi * j / n;
                    let x = Math.cos(a);
                    let y = Math.sin(a);

                    let nx = x * Math.SQRT1_2;
                    let ny = y * Math.SQRT1_2;
                    let nz = Math.SQRT1_2;

                    for (let i = 0; i <= m; i++) {

                        let z = i / m;

                        vertices.push(x * z);
                        vertices.push(y * z);
                        vertices.push(z);

                        vertices.push(nx);
                        vertices.push(ny);
                        vertices.push(nz);
                    }
                }

                for (let i = 0; i < m; i++) {
                    for (let j = 0; j < n; j++) {

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 2);
                        indices.push(off + j * (m + 1) + i + 1);

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 1);
                        indices.push(off + j * (m + 1) + i + m + 2);
                    }
                }
            }

            cone_index_count = indices.length - cone_index_offset;

            curve_index_offset = indices.length;

            {
                let n = 192;
                let m = 12;

                let off = vertices.length / 2;

                for (let j = 0; j <= n; j++) {
                    for (let i = 0; i <= m; i++) {
                        vertices.push(j / n);
                        vertices.push(2 * pi * i / m);
                    }
                }

                for (let i = 0; i < m; i++) {
                    for (let j = 0; j < n; j++) {

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 2);
                        indices.push(off + j * (m + 1) + i + 1);

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 1);
                        indices.push(off + j * (m + 1) + i + m + 2);
                    }
                }
            }

            curve_index_count = indices.length - curve_index_offset;

            segment_index_offset = indices.length;

            {
                let n = 1;
                let m = 12;

                let off = vertices.length / 2;

                for (let j = 0; j <= n; j++) {
                    for (let i = 0; i <= m; i++) {
                        vertices.push(j / n);
                        vertices.push(2 * pi * i / m);
                    }
                }

                for (let i = 0; i < m; i++) {
                    for (let j = 0; j < n; j++) {

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 2);
                        indices.push(off + j * (m + 1) + i + 1);

                        indices.push(off + j * (m + 1) + i);
                        indices.push(off + j * (m + 1) + i + m + 1);
                        indices.push(off + j * (m + 1) + i + m + 2);
                    }
                }
            }

            segment_index_count = indices.length - segment_index_offset;

            quad_index_offset = indices.length;

            {
                let off = vertices.length / 6;

                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < 2; j++) {
                        vertices.push(i);
                        vertices.push(j);
                        vertices.push(0);

                        vertices.push(0);
                        vertices.push(0);
                        vertices.push(1);
                    }
                }

                indices.push(off + 0);
                indices.push(off + 1);
                indices.push(off + 2);

                indices.push(off + 2);
                indices.push(off + 1);
                indices.push(off + 3);
            }

            quad_index_count = indices.length - quad_index_offset;


            gl.bindBuffer(gl.ARRAY_BUFFER, basic_vertex_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);


            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, basic_index_buffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        }

        let vertex_buffer = gl.createBuffer();
        let index_buffer = gl.createBuffer();

        let point_buffer = gl.createBuffer();

        let point_buffer_n = 1024;

        let has_xsnuke = false;

        var ext = gl.getExtension('OES_element_index_uint');
        let vao_ext = gl.getExtension('OES_vertex_array_object');

        function mark_ready() {
            if (has_xsnuke) {
                ready_callback();
            }
        }

        // data_for_vis500pr
        download_xs("/documents/finvis_html/data/data_for_vis475.json", function (buffer) {
            xs_nuke = JSON.parse(buffer);
            n_points = xs_nuke["Data"][0].length;
            // points prev are the x,y coordinates of the points. initiate as n_points with 2 entires of 0
            points_prev = [];
            for (var i = 0; i < n_points; i++) {
                points_prev.push({x: 0, y: 0, c: [0.8, 0.8, 0.8, .5], rr: 2});
            }

            points_histX = [];
            points_histY = [];

            for (var i = 0; i < n_points; i++) {
                points_histX.push(vec_zeros(points_hist_n));
                points_histY.push(vec_zeros(points_hist_n));
            }

            has_xsnuke = true;
            mark_ready();
            return xs_nuke;
        });


        let base_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;

        uniform mat4 m_mvp;
        uniform mat3 m_rot;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {
            vec3 pos = v_position;
            model_pos = pos;
            n_dir = m_rot * v_normal;
            gl_Position = m_mvp * vec4(pos, 1.0);
        }
        `;

        let base_vert_srcR =
            `
        attribute vec2 coordinates;
        varying highp vec2 unit;
        uniform float aspect;
        void main(void) {
            unit = coordinates;
            unit.x *= aspect;
            gl_Position = vec4(coordinates, 0.0, 1.0);
        }
        `;

        let segment_vert_src =
            `
        attribute vec2 v_st;

        uniform mat4 m_mvp;
        uniform mat3 m_rot;

        uniform vec3 p0;
        uniform vec3 p1;
        uniform float r;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {
            vec3 dummy0 = vec3(0.0, 0.0, 1.0);
            vec3 dummy1 = vec3(0.7071067812, -0.7071067812, 0.0);
            
            vec3 tan = normalize(p1 - p0);

            vec3 norm = abs(dot(tan, dummy0)) > abs(dot(tan, dummy1)) ? cross(tan, dummy1) 
                                                                      : cross(tan, dummy0);
            vec3 bnorm = normalize(cross(norm, tan));

            vec3 n = norm * sin(v_st.y) + bnorm * cos(v_st.y);

            vec3 p = mix(p0, p1, v_st.x) + n * r;;

            model_pos = p;
            n_dir = m_rot * n;
            gl_Position = m_mvp * vec4(p, 1.0);
        }
        `;

        let ellipse_vert_src =
            `
        attribute vec2 v_st;

        uniform mat4 m_mvp;
        uniform mat3 m_rot;

        uniform vec4 params;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {
            float x = params.x * cos(v_st.x * params.w);
            float y = params.y * sin(v_st.x * params.w);
            float z = params.z * cos(v_st.y);

            vec2 dir = normalize(vec2(x, y));
            x += params.z * dir.x * sin(v_st.y);
            y += params.z * dir.y * sin(v_st.y);
            
            vec3 n = vec3(dir * sin(v_st.y), cos(v_st.y));

            model_pos = vec3(x,y,z);
            n_dir = m_rot * n;
            gl_Position = m_mvp * vec4(model_pos, 1.0);
        }
        `;


        let preamble =
            `
            precision highp float;

            varying highp vec2 unit;
            uniform sampler2D noise_tex;
            
            uniform mat3 rot;

            float pi = 3.141592653589793;
            float BACKGROUND = 0.0;
            float BASE = 1.0;
            float LIGHT = 2.0;
            float WALL = 3.0;

            void ray(out vec3 ray_pos, out vec3 ray_dir, vec2 uv)
            {
                float camera_dist = 10.0;
                
                // float fov = 0.7853981634;
                // float fov_start = 1.0/tan(fov/2.0);
                float fov_start = 2.4142135624;
                
                vec3 pos = vec3(0.0,0.0,fov_start);

                vec3 dir = normalize(vec3(uv, 0.0) - pos);

                ray_dir = dir * rot;
                ray_pos = (vec3(0,0,camera_dist)) * rot;
            }

            float degammaf(float x) {
                return x < 0.04045 ? x * (1.0/12.92) : pow((x + 0.055)/1.055, 2.4);
            }

            float engammaf(float x) {
                return x < 0.0031308 ? x * 12.92 : (1.055 * pow(x, 1.0 / 2.4) - 0.055);
            }

            vec3 engamma(vec3 x) {
                x.r = engammaf(x.r);
                x.g = engammaf(x.g);
                x.b = engammaf(x.b);
                return x;
            }

            vec3 noise() {
                return vec3((texture2D(noise_tex, gl_FragCoord.xy*(1.0/32.0)).r - 0.495)*(1.0/255.0));
            }

            float sphere(vec3 origin, vec3 dir, vec3 pos, float r) {
                vec3 to_sphere = pos - origin;
                float a = dot(dir, dir);
                float b = -dot(to_sphere, dir);
                vec3 k = to_sphere + b/a*dir;
                float d = r*r - dot(k,k);

                return d;
            }

            float edge(vec3 v1, vec3 v2)
            {
                float x = dot(v1, v2);
                float y = abs(x);
                
                float theta_sintheta = y * (y * 0.308609 - 0.879406) + 1.5708;

                if (x < 0.0)
                    theta_sintheta = pi/sqrt(1.0 - x*x) - theta_sintheta;
                float u = cross(v1,v2).z;
                float res = theta_sintheta * u;

                return res;
            }
        `

        let ring_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;

        uniform vec2 stretch;
        uniform mat4 m_mvp;
        uniform mat3 m_rot;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {
            vec3 pos = v_position;

            vec2 dir = normalize (pos.xz);

            float a = atan(-pos.x, -pos.z);
            a *= stretch.x;

            pos.xz += stretch.y * dir;

            float c = cos(a);
            float s = sin(a);

            vec2 p = pos.xz;

            pos.x = p.x * c - p.y * s;
            pos.z = p.x * s + p.y * c;
            
            
            model_pos = pos;
            n_dir = m_rot * v_normal;
            gl_Position = m_mvp * vec4(pos, 1.0);
        }
        `;


        let color_frag_src =
            `
            precision mediump float;

            varying vec3 n_dir;
            varying vec3 model_pos;

            uniform vec4 color;

            void main(void) {
                
                vec4 c = color;
                c.rgb *= (0.75 + 0.25 * max(0.0, n_dir.z));
                gl_FragColor = c;
            }
    `;


        let color_frag_src2 =
            `
        precision mediump float;

        varying vec3 n_dir;
        varying vec3 model_pos;

        uniform vec4 color;
        uniform float normal_f;

        void main(void) {
            
            float f = mix(1.0, max(0.0, normalize(n_dir).z), normal_f);
            vec4 c = color;
            c.rgb *= sqrt(f);
            gl_FragColor = c;
        }
        `;


        let flat_frag_src =
            `
    precision mediump float;

    varying vec3 n_dir;
    varying vec3 model_pos;

    uniform vec4 color;

    void main(void) {
        
        vec4 c = color;
        
        c.rgb *= (0.75 + 0.25 * max(0.0, n_dir.z));
        gl_FragColor = c;
    }
`;


        let oil_frag_src =
            `
        precision mediump float;

        varying vec3 n_dir;
        varying vec3 model_pos;

        uniform vec4 color;
        uniform float t;

        void main(void) {

        vec4 c = color;

        c *= 0.4 + 0.6*noise(model_pos*2.0 + 2.0 * noise(model_pos*10.0 + t*20.0));
        gl_FragColor = c;
        }
        `;


        let spiral_frag_src =
            `
        precision mediump float;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {

            float r = length(model_pos.xy);
            float a = atan(model_pos.y, model_pos.x);

            float h0 = smoothstep(-0.2, 0.2, sin(20.0*r + a));
            float h1 = smoothstep(-0.2, 0.2, 10.0*sin(a*4.0));
            float h = mix(h1, h0, model_pos.z);
            h *= 1.0 - smoothstep(0.9, 0.92, r);
            h = 0.1 + 0.85*h;
            h *= (0.75 + 0.25 * max(0.0, n_dir.z));

            vec4 c = vec4(h, h, h, 1);

            gl_FragColor = c;
        }
        `;

        let cross_frag_src =
            `
    precision mediump float;

    varying vec3 n_dir;
    varying vec3 model_pos;

    uniform vec4 color;
    uniform vec4 cross_section_plane;
    uniform vec3 cross_section_param;

    void main(void) {
        
        vec4 c = color;

        if (dot(model_pos, cross_section_plane.xyz) < cross_section_plane.w) {

            float t = dot(model_pos, cross_section_param);
            c.rgb *= 0.85 + 0.2 * max(0.0, min(1.0, 5.0*sin(t*10.0)));
        }
        c.rgb *= (0.75 + 0.25 * max(0.0, n_dir.z));
        gl_FragColor = c;
    }
`;


        // left/right encoded in normal's length, which is either 1.0 or 2.0, scaling all components by 2
        // keeps the mantissa intact, so we're not losing any precision
        let line_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;

        uniform mat4 m_mvp;
        uniform vec4 line_p;

        varying float dist;

        void main(void) {

            vec3 normal = v_normal;

            float perp_sign = -1.0;

            if (dot(normal, normal) > 1.5) {
                perp_sign = 1.0;
                normal *= 0.5;
            }
            perp_sign *= line_p.w;

            dist = perp_sign;

            vec3 pos = v_position;

            vec4 position = m_mvp * vec4(pos + normal * line_p.x, 1.0);
            
            normal = (m_mvp * vec4(normal, 0.0)).xyz;
     
            vec2 ss_normal = normalize(normal.xy);

            float width = line_p.x;
            position.x += width * line_p.z * ss_normal.y * -perp_sign;
            position.y += width * ss_normal.x * perp_sign;
            position.z -= 0.0003;
            gl_Position = position;
        }
        `;

        let line2_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;

        uniform mat4 m_mvp;
        uniform vec4 line_p;

        varying float dist;

        void main(void) {

            vec3 normal = v_normal;

            float perp_sign = -1.0;

            if (dot(normal, normal) > 1.5) {
                perp_sign = 1.0;
                normal *= 0.5;
            }
            perp_sign *= line_p.w;

            dist = perp_sign;

            vec3 pos = v_position;

            vec4 position = m_mvp * vec4(pos + normal * line_p.x, 1.0);
            
            normal = (m_mvp * vec4(normal, 0.0)).xyz;
     
            vec2 ss_normal = normalize(normal.xy);

            float width = line_p.x;
            position.x += width * line_p.z * ss_normal.y * -perp_sign;
            position.y += width * ss_normal.x * perp_sign;
            position.z -= 0.0003;
            gl_Position = position;
        }
        `;

        let line_ring_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;


        uniform vec2 stretch;

        uniform mat4 m_mvp;
        uniform mat3 m_rot;
        uniform vec4 line_p;

        varying float dist;

        void main(void) {

            vec3 normal = v_normal;

            float perp_sign = -1.0;

            if (dot(normal, normal) > 1.5) {
                perp_sign = 1.0;
                normal *= 0.5;
            }
            perp_sign *= line_p.w;

            dist = perp_sign;

            vec3 pos = v_position;

            vec2 dir = normalize (pos.xz);

            float a = atan(-pos.x, -pos.z);
            a *= stretch.x;

            pos.xz += stretch.y * dir;

            float c = cos(a);
            float s = sin(a);

            vec2 p = pos.xz;

            pos.x = p.x * c - p.y * s;
            pos.z = p.x * s + p.y * c;

            vec4 position = m_mvp * vec4(pos + normal * line_p.x, 1.0);
            
            normal = (m_mvp * vec4(normal, 0.0)).xyz;
     
            vec2 ss_normal = normalize(normal.xy);

            float width = line_p.x;
            position.x += width * line_p.z * ss_normal.y * -perp_sign;
            position.y += width * ss_normal.x * perp_sign;
            position.z -= 0.0003;
            gl_Position = position;
        }
        `;


        let line_frag_src =
            `
            precision mediump float;

            varying float dist;

            uniform vec4 color;

            void main(void) {
            
                gl_FragColor = color;
            }
    `;


        let spring_vert_src =
            `
        attribute vec3 v_position;
        attribute vec3 v_normal;

        uniform vec3 Rrl;
        uniform mat4 m_mvp;
        uniform mat3 m_rot;
        uniform vec2 spring_param;

        varying vec3 n_dir;
        varying vec3 model_pos;

        void main(void) {
            vec3 pos = v_position;
            float t = pos.z;
            float a = t*3.1415926*spring_param.x;

            float h = spring_param.y != 0.0 ? t*t*(3.0*(1.0-t) + t) : t;
            vec3 n = v_normal;
            n.xz = n.xy;
            n.y = cos(a)*n.x;
            n.x = sin(a)*n.x;

       
            pos.xz = pos.xy * Rrl.y;
            pos.x += Rrl.x;
            pos.y = cos(a)*pos.x;
            pos.x = sin(a)*pos.x;
            pos.z += h * (Rrl.z + Rrl.y) - Rrl.y*0.5;
            if (spring_param.y != 0.0) {
                pos.z = min(Rrl.z, pos.z);
                pos.z = max(0.0, pos.z);
            }
            model_pos = pos;
            n_dir = m_rot * n;
            gl_Position = m_mvp * vec4(pos, 1.0);
            
        }
        `;


        let flame_vert_src =
            `
        attribute vec3 v_position;

        uniform mat4 m_m;
        uniform mat4 m_mvp;

        varying vec3 model_pos;

        void main(void) {
            vec3 pos = v_position;
            model_pos = (m_m * vec4(v_position, 1.0)).xyz;
            gl_Position = m_mvp * vec4(v_position, 1.0);
        }
        `;

        let flame_pre_src = `     
         precision highp float;

        varying vec3 model_pos;

        uniform vec3 dir;
        uniform highp vec4 params;
        uniform vec4 pre_color;
        uniform vec4 post_color;
        uniform vec4 f0_color;
        uniform vec4 f1_color;`

        let noise_pre_src =
            `
        float hash (vec3 st) {
            return fract(sin(dot(st,
                                 vec3(13.54353, 83.8981, 342.875345)))
                         * 43758.5453123);
        }

        float noise(in vec3 x)
        {
            vec3 i = floor(x);
            vec3 f = x-i;
            
            return mix(mix(mix(hash(i+vec3(0,0,0)), 
                               hash(i+vec3(1,0,0)),f.x),
                           mix(hash(i+vec3(0,1,0)), 
                               hash(i+vec3(1,1,0)),f.x),f.y),
                       mix(mix(hash(i+vec3(0,0,1)), 
                               hash(i+vec3(1,0,1)),f.x),
                           mix(hash(i+vec3(0,1,1)), 
                               hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        `

        let flame_frag_src = `
        
        
        float f(vec3 p) {
            p.y += params.z;
            float h = params.z;
            float r = params.y;

            vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
            return min(max(d.x,d.y),0.0) + length(max(d,0.0));
        }

        float f2(vec3 p, float k) {

    
            p.y += params.w * 0.5;
            return length(p)-(k*0.2 + 0.8)*params.w;
        }
     

        void main(void) {
            
            
            vec3 pos = model_pos;

            float a = 0.0;
            float r = 0.0;
            float post = 0.0;
        
            float t = params.x;
            float ys =  30.0/params.z;

            for (int i = 0; i < 5; i++) {
                float dist = f(pos);
                float p = 1.0 - smoothstep(-STEP*0.5, STEP * 0.5, dist);
                float k = noise(pos*(0.3)*vec3(1.0, ys, 1.0) + 10.0*p*noise(pos*(0.2) + t));
                if (dist < STEP * 0.5) {            
                    a += p*k * min(1.0, 1.0 - dist * (1.0 / STEP));
                }                
                
                dist = f2(pos, k);

                if (dist < 0.0) {
                    r += 0.2 * min(1.0, 1.0 - dist * (1.0 / STEP));
                    post = 1.0;
                }

                pos += dir;
            }
     
            r = r > 0.0 ? 1.0 -r : 0.0;

            vec4 c = a*mix(pre_color, post_color, post);
     
            c += f0_color * smoothstep(0.8, 0.9, r);
            c += f1_color * smoothstep(0.3, 0.7, r);
            
            gl_FragColor = c;
        }
        `;


        let complex_flame_vert_src =
            `
        attribute vec3 v_position;

        uniform vec4 params;
        uniform mat4 m_m;
        uniform mat4 m_mvp;

        varying vec3 model_pos;
        varying vec3 vert_params;

        void main(void) {
            vec3 pos = v_position;
            if (pos.z <= -0.5) {
                pos.z -= params.z*2.0;
            }
            vert_params.x = 100.0/(params.z + 20.0);
            vert_params.y = params.z + 15.0;
            vert_params.z = params.w * 0.5 - 15.0;
            model_pos = (m_m * vec4(pos, 1.0)).xyz;
            model_pos.x -= 3.0;
            gl_Position = m_mvp * vec4(pos, 1.0);
        }
        `;

        let complex_flame_frag_src = `
        
        varying vec3 vert_params;

        float f(vec3 p) {
            p.z += params.z;
            float h = vert_params.y;
            float r = params.y;

            vec2 d = abs(vec2(length(p.xy),p.z)) - vec2(r,h);
            return min(max(d.x,d.y),0.0) + length(max(d,0.0));
        }

        float f2(vec3 p, float k) {

            p.z += vert_params.z;
            return length(p)-(k*0.2 + 0.8)*params.w;
        }
     

        void main(void) {
            
            
            vec3 pos = model_pos;

            float a = 0.0;
            float r = 0.0;
            float post = 0.0;
        
            float t = params.x;
            float ys = vert_params.x;

            for (int i = 0; i < 5; i++) {
                float dist = f(pos);
                float p = 1.0 - smoothstep(-STEP*0.5, STEP * 0.5, dist);
                float k = noise(pos*(0.3)*vec3(1.0, 1.0, ys) + 10.0*p*noise(pos*(0.3) + t));
                if (dist < STEP * 0.5) {            
                    a += p*k * min(1.0, 1.0 - dist * (1.0 / STEP));
                }                
                
                dist = f2(pos, k);

                if (dist < 0.0) {
                    r += min(1.0, 1.0 - dist * (1.0 / STEP));
                    post = 1.0;
                }

                pos += dir;
            }
     
            r = r > 0.0 ? 1.0 - r*0.2 : 0.0;

            vec4 c = a*mix(pre_color, post_color, post);
     
            c += f0_color * smoothstep(0.8, 0.9, r);
            c += f1_color * smoothstep(0.3, 0.7, r);
            
            gl_FragColor = c;
        }
        `;


        let point_vert_src =
            `
        attribute float point_t;
        uniform mat4 m_mvp;
        uniform float t;

        varying mediump vec4 color;

        float hash(float n)
        {
            return fract(sin(n) * 43758.5453);
        }

        void main(void) {
            float tt = (point_t - 1.0) + t;
            tt = max(0.0, min(1.0, tt*2.0));

            float h = hash(point_t);
            float r = tt * 2.5 * (1.0 + h*5.0) + 0.5;
            float x = r*cos(h*30.0);
            float y = r*sin(h*30.0);
            float z = -tt * (40.0 + h*15.0);

            gl_Position = m_mvp * vec4(x, y, z, 1.0);
            color = vec4(236.0/255.0, 163.0/255.0, 48.0/255.0, 1.0) * (1.0 - tt);

            gl_PointSize = tt == 0.0 ? 0.0 : (1.0 + tt * 10.0);
        }
        `;

        let point_frag_src =
            `
        varying mediump vec4 color;
        precision mediump float;

        void main(void) {
            mediump vec2 xy = (gl_PointCoord - 0.5);
            mediump float d = dot(xy, xy);
            mediump float a = 1.0 - smoothstep(0.0, 0.25, d);

            gl_FragColor = color * a;
        }
        `;


        let area_frag_src =
            `
            uniform mat3 light_rot;
            uniform mat3 inv_light_rot;
            uniform vec3 light_pos;
            float light_size = 0.25;


            void main(void) {    
                float base_width = 5.0;
                float base_height = 5.0;
                float light_width = 1.8;
                float light_height = 1.4;
    
                vec3 ray_org, ray_dir;
                ray(ray_org, ray_dir, unit);
                
                float base_t = -ray_org.z / ray_dir.z;
                vec3 base_hit = ray_dir * base_t + ray_org;
                float col = 0.0;
                float alpha = 0.0;

                if (abs(base_hit.x) < base_width*0.5 && abs(base_hit.y) < base_height*0.5)
                {
                    col = 0.4;
                    alpha = 1.0;

                    vec3 l0 = normalize(vec3(-light_width*0.5,-light_height*0.5,0.0)*light_rot - base_hit + light_pos);
                    vec3 l1 = normalize(vec3(-light_width*0.5, light_height*0.5,0.0)*light_rot - base_hit + light_pos);
                    vec3 l2 = normalize(vec3( light_width*0.5, light_height*0.5,0.0)*light_rot - base_hit + light_pos);
                    vec3 l3 = normalize(vec3( light_width*0.5,-light_height*0.5,0.0)*light_rot - base_hit + light_pos);

                    float sum;
                    sum  = edge(l0, l1);
                    sum += edge(l1, l2);
                    sum += edge(l2, l3);
                    sum += edge(l3, l0);

                    col *= sum;
                }

                
                gl_FragColor = vec4(vec3((engammaf(col) + noise().x)*alpha), alpha);
            }
            `;

        let solid_angle_frag_src =
            `
            uniform mat3 quad_rot;
            uniform vec2 quad_size;
            uniform vec4 sphere_param;
            uniform vec3 quad_pos;
            uniform float top;

            void main(void) {    
  
                vec3 ray_org, ray_dir;
                ray(ray_org, ray_dir, unit);
      
                float r = sphere_param.w;

                vec3 f = ray_org - sphere_param.xyz;
                float b2 = dot(f,ray_dir);
                float r2 = r * r;
                vec3 fd = f - b2 * ray_dir;
                float d = r2 - dot(fd, fd);
                vec4 col = vec4(0.0);

                if (d >= 0.0) {
                    float c = dot(f, f) - r2;
                    float sq = sqrt(d);
                    float q = (b2 >= 0.0 ? -sq : sq) - b2;
    
                    float t0 = c/q;
                    float t1 = q;

                    vec3 dir0 = ray_org + t0*ray_dir;
                    vec3 dir1 = ray_org + t1*ray_dir;

            

                    if (top == 0.0 || dir0.z >= 0.0 || dir1.z >= 0.0) {
                        col = vec4(0.15);

                        float up0 = dir0.z;
                        float up1 = dir1.z;

                    dir0 *= quad_rot;
                    dir1 *= quad_rot;

                    // draw hemisphere
                    vec3 o = (sphere_param.xyz - quad_pos)*quad_rot;

                    vec2 hit0 = o.xy + -dir0.xy*o.z/(dir0.z);
                    vec2 hit1 = o.xy + -dir1.xy*o.z/(dir1.z);
                  
                    if (up0 > 0.0 && abs(hit0.x) < quad_size.x && abs(hit0.y) < quad_size.y)
                        col = vec4(0.913*0.5, 0.663*0.5, 0.099*0.5, 0.5);
                    else if (up1 > 0.0 && abs(hit1.x) < quad_size.x && abs(hit1.y) < quad_size.y)
                        col = vec4(0.94, 0.76, 0.40, 1.0) * 0.5;
                    }

                }
            
                gl_FragColor = col;
            }
            `;


        let edge_frag_src =
            `
        precision mediump float;

        varying vec3 n_dir;
        varying vec3 model_pos;

        uniform vec4 color;
        uniform vec4 clip;

        float hash(vec2 p)
        {
            return fract(sin(dot(p,vec2(129.1,311.7)))*43758.5453123);
        }

        void main(void) {
            
        
            vec3 n = normalize(n_dir);
            float f = 1.0 - abs(n.z);
            f = f * f * f * 0.8 + 0.2;
            
            f *= (254.0/255.0 + 2.0 / 255.0 * hash(gl_FragCoord.xy));

            if (dot(model_pos, clip.xyz) > clip.w)
                f = 0.0;

            gl_FragColor = color * f;
        }
        `;

        let hill_edge_frag_src =
            `
    precision mediump float;

    varying vec3 n_dir;
    varying vec3 model_pos;

    uniform vec4 color;
    uniform vec4 param;

    float hash(vec2 p)
    {
        return fract(sin(dot(p,vec2(129.1,311.7)))*43758.5453123);
    }

    void main(void) {
        
    
        vec3 n = normalize(n_dir);
        float f = 1.0 - abs(n.z);
        f = f * f * f * 0.8 + 0.2;
        
        f *= (254.0/255.0 + 2.0 / 255.0 * hash(gl_FragCoord.xy));

        vec3 pp = model_pos*param.w + param.xyz;

        if (pp.z < 0.0)
            f = 0.0;

        vec3 wall_n = vec3(0.894427190999916, 0.0, -0.44721359549995787);
            
        if (dot(pp, wall_n) > 0.6 * 0.894427190999916 &&
            pp.z < 0.2 && pp.x < 0.7)
            f = 0.0;

        vec2 pos_norm = normalize(param.xz - vec2(0.7, 0.2));
        pos_norm = vec2(-pos_norm.y, pos_norm.x);
        
        vec3 shadow_norm = vec3(pos_norm.x, 0, pos_norm.y);

        if (dot(pp, shadow_norm) > dot(param.xyz, shadow_norm) && pp.x > 0.7)
            f = 0.0;

        gl_FragColor = color * f;
    }
    `;

        let stroke_frag_src =
            `
    precision mediump float;

    varying vec3 n_dir;
    varying vec3 model_pos;

    uniform vec4 color;

    void main(void) {
        
    
        vec3 n = normalize(n_dir);
        float f = 1.0 - abs(n.z);
        
        vec4 c = color;
        c.rgb *= 1.0 - smoothstep(0.2, 0.4, f) * 0.5;
        gl_FragColor = c;
    }
    `;


        let cross_shader = new Shader(gl,
            base_vert_src,
            cross_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "color", "cross_section_plane", "cross_section_param"]);

        let simple_shader = new Shader(gl,
            base_vert_src,
            color_frag_src2, ["v_position", "v_normal"], ["m_mvp", "m_rot", "color", "normal_f"]);


        let flat_shader = new Shader(gl,
            base_vert_src,
            flat_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "color"]);

        let segment_shader = new Shader(gl,
            segment_vert_src,
            color_frag_src, ["v_st"], ["m_mvp", "m_rot", "p0", "p1", "r", "color", "normal_f"]);


        let oil_shader = new Shader(gl,
            base_vert_src,
            "precision highp float;\n" + noise_pre_src + oil_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "color", "t"]);

        let spiral_shader = new Shader(gl,
            base_vert_src,
            spiral_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot"]);

        let flame_shader = new Shader(gl,
            flame_vert_src,
            "#define STEP " + march_step.toFixed(1) + "\n" + flame_pre_src + noise_pre_src + flame_frag_src,
            ["v_position"],
            ["m_m", "m_mvp", "m_rot", "dir", "params", "pre_color", "post_color", "f0_color", "f1_color"]);

        let complex_flame_shader = new Shader(gl,
            complex_flame_vert_src,
            "#define STEP " + march_step.toFixed(1) + "\n" + flame_pre_src + noise_pre_src + complex_flame_frag_src,
            ["v_position"],
            ["m_m", "m_mvp", "m_rot", "dir", "params", "pre_color", "post_color", "f0_color", "f1_color"]);


        let line_shader = new Shader(gl,
            line_vert_src,
            line_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "line_p", "color"]);

        let line_shader2 = new Shader(gl,
            line2_vert_src,
            line_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "line_p", "color"]);


        let ring_shader = new Shader(gl,
            ring_vert_src,
            color_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "color", "stretch"]);

        let line_ring_shader = new Shader(gl,
            line_ring_vert_src,
            line_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "line_p", "color", "stretch"]);


        let spring_shader = new Shader(gl,
            spring_vert_src,
            color_frag_src,
            ["v_position", "v_normal"],
            ["m_mvp", "m_rot", "color", "Rrl", "spring_param"]);

        let point_shader = new Shader(gl,
            point_vert_src,
            point_frag_src,
            ["point_t"],
            ["m_mvp", "t"]);

        let area_shader = new Shader(gl,
            base_vert_srcR,
            preamble + area_frag_src,
            ["coordinates"],
            ["aspect", "rot", "noise_tex", "light_rot", "inv_light_rot", "light_pos"]);

        let solid_angle_shader = new Shader(gl,
            base_vert_srcR,
            preamble + solid_angle_frag_src,
            ["coordinates"],
            ["aspect", "rot", "noise_tex", "quad_rot", "quad_size", "sphere_param", "quad_pos", "top"]);


        let stroke_shader = new Shader(gl,
            base_vert_src,
            stroke_frag_src, ["v_position", "v_normal"], ["m_mvp", "m_rot", "color"]);

        let edge_shader = new Shader(gl,
            base_vert_src,
            edge_frag_src, ["v_position", "v_normal"], ["m_mvp", "m_rot", "color", "clip"]);

        let hill_edge_shader = new Shader(gl,
            base_vert_src,
            hill_edge_frag_src, ["v_position", "v_normal"], ["m_mvp", "m_rot", "color", "param"]);
        let ellipse_shader = new Shader(gl,
            ellipse_vert_src,
            color_frag_src, ["v_st"], ["m_mvp", "m_rot", "params", "color", "normal_f"]);


        let mesh_cross_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(mesh_cross_vao);

        // vertex buffer is 12 bytes for xyz of vertex, and then 12 bytes for xyz of normal
        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(cross_shader.attributes["v_position"]);
        gl.vertexAttribPointer(cross_shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(cross_shader.attributes["v_normal"]);
        gl.vertexAttribPointer(cross_shader.attributes["v_normal"], 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);


        let mesh_flat_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(mesh_flat_vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(cross_shader.attributes["v_position"]);
        gl.vertexAttribPointer(cross_shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(cross_shader.attributes["v_normal"]);
        gl.vertexAttribPointer(cross_shader.attributes["v_normal"], 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);


        let mesh_line_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(mesh_line_vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(line_shader.attributes["v_position"]);
        gl.vertexAttribPointer(line_shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(line_shader.attributes["v_normal"]);
        gl.vertexAttribPointer(line_shader.attributes["v_normal"], 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);

        let simp_line_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(simp_line_vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(line_shader2.attributes["v_position"]);
        gl.vertexAttribPointer(line_shader2.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);

        let ring_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(ring_vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(ring_shader.attributes["v_position"]);
        gl.vertexAttribPointer(ring_shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(ring_shader.attributes["v_normal"]);
        gl.vertexAttribPointer(ring_shader.attributes["v_normal"], 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);

        let ring_line_vao = vao_ext.createVertexArrayOES();
        vao_ext.bindVertexArrayOES(ring_line_vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
        gl.enableVertexAttribArray(line_ring_shader.attributes["v_position"]);
        gl.vertexAttribPointer(line_ring_shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(line_ring_shader.attributes["v_normal"]);
        gl.vertexAttribPointer(line_ring_shader.attributes["v_normal"], 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);


        vao_ext.bindVertexArrayOES(null);

        let prev_width, prev_height;

        this.begin = function (width, height) {

            width *= scale;
            height *= scale;
            if (width != prev_width || height != prev_height) {
                canvas.width = width;
                canvas.height = height;
                prev_width = width;
                prev_height = height;
            }

            gl.viewport(0, 0, width, height);

            gl.disable(gl.BLEND);
            gl.depthMask(true);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
            gl.enable(gl.DEPTH_TEST);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            viewport_x = 0;
            viewport_y = 0;
            viewport_w = Math.round(width);
            viewport_h = Math.round(height);
        }

        this.enable_blend = function () {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }

        function setup_shader(shader) {
            gl.useProgram(shader.shader);
            gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
            gl.enableVertexAttribArray(shader.attributes["coordinates"]);
            gl.vertexAttribPointer(shader.attributes["coordinates"], 2, gl.FLOAT, false, 0, 0);
            gl.uniform1f(shader.uniforms["aspect"], canvas.width / canvas.height);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures[1]);
            gl.uniform1i(shader.uniforms["noise_tex"], 0);
        }

        this.viewport = function (x, y, w, h) {
            gl.viewport(x * scale, y * scale, w * scale, h * scale);

            viewport_x = Math.round(x * scale);
            viewport_y = Math.round(y * scale);
            viewport_w = Math.round(w * scale);
            viewport_h = Math.round(h * scale);
        }


        this.flush = function () {
            gl.flush();
        }


        this.draw_points = function (mvp, t) {

            gl.useProgram(point_shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, point_buffer);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);
            gl.enableVertexAttribArray(point_shader.attributes["point_t"]);
            gl.vertexAttribPointer(point_shader.attributes["point_t"], 1, gl.FLOAT, false, 0, 0);

            gl.uniformMatrix4fv(point_shader.uniforms["m_mvp"], false, mat4_transpose(mvp));

            gl.uniform1f(point_shader.uniforms["t"], t);

            gl.drawArrays(gl.POINTS, 0, point_buffer_n);

        }

        this.draw_area = function (rot, light_rot, light_pos) {
            setup_shader(area_shader);
            gl.uniformMatrix3fv(area_shader.uniforms["rot"], false, mat3_transpose(rot));
            gl.uniformMatrix3fv(area_shader.uniforms["light_rot"], false, light_rot);
            gl.uniformMatrix3fv(area_shader.uniforms["inv_light_rot"], false, mat3_invert(light_rot));
            gl.uniform3fv(area_shader.uniforms["light_pos"], light_pos);

            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        this.draw_solid_angle = function (rot, quad_rot, quad_size, quad_pos, top, sphere_param) {
            if (top === undefined)
                top = 0.0;
            if (sphere_param === undefined)
                sphere_param = [0, 0, 0, 1.4];
            setup_shader(solid_angle_shader);
            gl.uniformMatrix3fv(solid_angle_shader.uniforms["rot"], false, mat3_transpose(rot));
            gl.uniformMatrix3fv(solid_angle_shader.uniforms["quad_rot"], false, quad_rot);
            gl.uniform4fv(solid_angle_shader.uniforms["sphere_param"], sphere_param);
            gl.uniform2f(solid_angle_shader.uniforms["quad_size"], quad_size[0] * 0.5, quad_size[1] * 0.5);
            gl.uniform3fv(solid_angle_shader.uniforms["quad_pos"], quad_pos);
            gl.uniform1f(solid_angle_shader.uniforms["top"], top);

            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        this.draw_quad = function (mvp, rot, color, mode) {

            let shader = simple_shader;

            if (mode === "depth") {
                gl.colorMask(false, false, false, false);
            } else if (color[3] != 1) {
                gl.enable(gl.BLEND);
                gl.disable(gl.CULL_FACE);
                gl.depthMask(false);
            }

            gl.useProgram(shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, basic_vertex_buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, basic_index_buffer);

            gl.enableVertexAttribArray(shader.attributes["v_position"]);
            gl.vertexAttribPointer(shader.attributes["v_position"], 3, gl.FLOAT, false, 6 * float_size, 0);
            gl.enableVertexAttribArray(shader.attributes["v_normal"]);
            gl.vertexAttribPointer(shader.attributes["v_normal"], 3, gl.FLOAT, false, 6 * float_size, 3 * float_size);

            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(shader.uniforms["m_rot"], false, mat3_invert(rot));

            gl.uniform4fv(shader.uniforms["color"], color);
            gl.uniform1f(shader.uniforms["normal_f"], 0.0);

            gl.drawElements(gl.TRIANGLES, quad_index_count, gl.UNSIGNED_INT, quad_index_offset * 4);

            if (mode === "depth")
                gl.colorMask(true, true, true, true);
        }

        this.draw_segment = function (mvp, rot, color, p0, p1, r, mode) {

            let shader = segment_shader;

            if (mode === "depth") {
                gl.colorMask(false, false, false, false);
            } else if (color[3] != 1) {
                gl.enable(gl.BLEND);
                gl.disable(gl.CULL_FACE);
                gl.depthMask(false);
            }

            gl.useProgram(shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, basic_vertex_buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, basic_index_buffer);

            gl.enableVertexAttribArray(shader.attributes["v_st"]);
            gl.vertexAttribPointer(shader.attributes["v_st"], 2, gl.FLOAT, false, 2 * float_size, 0);

            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(shader.uniforms["m_rot"], false, mat3_invert(rot));

            gl.uniform3fv(shader.uniforms["p0"], p0);
            gl.uniform3fv(shader.uniforms["p1"], p1);
            gl.uniform1f(shader.uniforms["r"], r);

            gl.uniform4fv(shader.uniforms["color"], color);
            gl.uniform1f(shader.uniforms["normal_f"], 0.0);

            gl.drawElements(gl.TRIANGLES, segment_index_count,
                gl.UNSIGNED_INT, segment_index_offset * 4);

            if (mode === "depth")
                gl.colorMask(true, true, true, true);
        }

        this.draw_sphere = function (mvp, rot, color, r, mode, param) {

            let shader = simple_shader;

            mvp = mat4_mul(mvp, scale_mat4(r));

            if (mode === "edge" || mode === "hill_edge") {
                gl.enable(gl.BLEND);
                gl.disable(gl.CULL_FACE);
                gl.depthMask(false);
                shader = mode === "edge" ? edge_shader : hill_edge_shader;
            } else if (mode === "stroke") {
                shader = stroke_shader;
            } else if (mode === "depth") {
                gl.colorMask(false, false, false, false);
            }

            gl.useProgram(shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, basic_vertex_buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, basic_index_buffer);

            gl.enableVertexAttribArray(shader.attributes["v_position"]);
            gl.vertexAttribPointer(shader.attributes["v_position"], 3, gl.FLOAT, false, 6 * float_size, 0);
            gl.enableVertexAttribArray(shader.attributes["v_normal"]);
            gl.vertexAttribPointer(shader.attributes["v_normal"], 3, gl.FLOAT, false, 6 * float_size, 3 * float_size);

            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(shader.uniforms["m_rot"], false, mat3_invert(rot));

            if (mode === "edge") {
                if (!param)
                    param = [0, 0, -1, 10000];
                gl.uniform4fv(shader.uniforms["clip"], param);
            } else if (mode === "hill_edge") {
                gl.uniform4fv(shader.uniforms["param"], param);
            }


            gl.uniform4fv(shader.uniforms["color"], color);
            gl.uniform1f(shader.uniforms["normal_f"], 0.0);

            gl.drawElements(gl.TRIANGLES, sphere_index_count, gl.UNSIGNED_INT, sphere_index_offset * 4);

            if (mode === "depth")
                gl.colorMask(true, true, true, true);

        }

        this.draw_ellipse = function (mvp, rot, color, a, e, r, span) {

            let shader = ellipse_shader;
            let b = a * Math.sqrt(1 - e * e);
            let c = e * a;

            if (span === undefined) {
                span = 2 * pi;
            }

            mvp = mat4_mul(mvp, translation_mat4([-c, 0, 0]));

            if (color[3] != 1) {
                gl.enable(gl.BLEND);
                gl.disable(gl.CULL_FACE);
                gl.depthMask(false);
            }

            gl.useProgram(shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, basic_vertex_buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, basic_index_buffer);

            gl.enableVertexAttribArray(shader.attributes["v_st"]);
            gl.vertexAttribPointer(shader.attributes["v_st"], 2, gl.FLOAT, false, 2 * float_size, 0);

            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(shader.uniforms["m_rot"], false, mat3_invert(rot));

            gl.uniform4fv(shader.uniforms["params"], [a, b, r, span]);
            gl.uniform4fv(shader.uniforms["color"], color);
            gl.uniform1f(shader.uniforms["normal_f"], 0.0);

            gl.drawElements(gl.TRIANGLES, curve_index_count,
                gl.UNSIGNED_INT, curve_index_offset * 4);
        }


        this.draw_mesh = function (name, mvp, rotation, color, opacity, backface, cross_section, line_dim, line_arg, skip_line) {

            if (opacity === undefined)
                opacity = 1.0;

            if (line_arg === undefined)
                line_arg = [3 / viewport_h, 0.01];

            line_arg.push(viewport_h / viewport_w); // aspect ratio
            line_arg.push(backface ? -1 : 1); // backface

            if (line_dim === undefined)
                line_dim = vec_scale(color, 0.8);

            if (opacity == 1.0) {
                gl.disable(gl.BLEND);
                gl.depthMask(true);

            } else {
                gl.enable(gl.BLEND);
                gl.depthMask(false);
            }

            if (cross_section === true)
                cross_section = [[1, 0, 0, 0.01], [0.01, 0.01, 0.0]];

            let mesh = models[name];

            let shader = cross_section ? cross_shader : flat_shader;

            color = vec_scale(color, opacity);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(backface ? gl.FRONT : gl.BACK);

            gl.useProgram(shader.shader);

            vao_ext.bindVertexArrayOES(cross_section ? mesh_cross_vao : mesh_flat_vao);

            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(shader.uniforms["m_rot"], false, mat3_invert(rotation));

            gl.uniform4fv(shader.uniforms["color"], color);

            if (cross_section) {
                gl.uniform4fv(shader.uniforms["cross_section_plane"], cross_section[0]);
                gl.uniform3fv(shader.uniforms["cross_section_param"], cross_section[1]);
            }


            gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, mesh.index_offset * 4);

            if (skip_line)
                return;
            if (1 === 1) {
                color[0] = line_dim[0];
                color[1] = line_dim[1];
                color[2] = line_dim[2];

                gl.useProgram(line_shader.shader);
                vao_ext.bindVertexArrayOES(mesh_line_vao);

                gl.uniformMatrix4fv(line_shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
                gl.uniform4fv(line_shader.uniforms["line_p"], line_arg);
                gl.uniform4fv(line_shader.uniforms["color"], color);

                gl.drawElements(gl.TRIANGLES, mesh.line_index_count, gl.UNSIGNED_INT, mesh.line_index_offset * 4);
                vao_ext.bindVertexArrayOES(null);

            } else {
                color[0] = line_dim[0];
                color[1] = line_dim[1];
                color[2] = line_dim[2];

                gl.useProgram(line_shader2.shader);
                vao_ext.bindVertexArrayOES(simp_line_vao);

                gl.uniformMatrix4fv(line_shader2.uniforms["m_mvp"], false, mat4_transpose(mvp));
                gl.uniform4fv(line_shader2.uniforms["line_p"], line_arg);
                gl.uniform4fv(line_shader2.uniforms["color"], color);

                gl.drawElements(gl.LINE_STRIP, mesh.line_index_count, gl.UNSIGNED_INT, mesh.line_index_offset * 4);
                vao_ext.bindVertexArrayOES(null);
            }

        }

        this.draw_ring_mesh = function (name, mvp, rotation, color, opacity, stretch) {

            if (opacity === undefined)
                opacity = 1.0;

            if (stretch == undefined)
                stretch = [0, 0];

            let line_arg = [2 / viewport_h, 0.01];

            line_arg.push(viewport_h / viewport_w);
            line_arg.push(1);

            if (opacity == 1.0) {
                gl.disable(gl.BLEND);
                gl.depthMask(true);

            } else {
                gl.enable(gl.BLEND);
                gl.depthMask(false);
            }

            color = vec_scale(color, opacity);

            let mesh = models[name];

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            gl.useProgram(ring_shader.shader);

            vao_ext.bindVertexArrayOES(ring_vao);

            gl.uniformMatrix4fv(ring_shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(ring_shader.uniforms["m_rot"], false, mat3_invert(rotation));

            gl.uniform4fv(ring_shader.uniforms["color"], color);
            gl.uniform2fv(ring_shader.uniforms["stretch"], stretch);


            gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, mesh.index_offset * 4);


            let dim = 0.5;

            color[0] *= dim;
            color[1] *= dim;
            color[2] *= dim;

            gl.useProgram(line_ring_shader.shader);
            vao_ext.bindVertexArrayOES(ring_line_vao);

            gl.uniformMatrix4fv(line_ring_shader.uniforms["m_mvp"], false, mat4_transpose(mvp));
            gl.uniformMatrix3fv(line_ring_shader.uniforms["m_rot"], false, mat3_invert(rotation));

            gl.uniform4fv(line_ring_shader.uniforms["color"], color);
            gl.uniform2fv(line_ring_shader.uniforms["stretch"], stretch);
            gl.uniform4fv(line_ring_shader.uniforms["line_p"], line_arg);

            gl.drawElements(gl.TRIANGLES, mesh.line_index_count, gl.UNSIGNED_INT, mesh.line_index_offset * 4);

            vao_ext.bindVertexArrayOES(null);
        }

        this.draw_flame = function (m, mvp, dir, params, pre_color, post_color, f0_color, f1_color, complex) {

            gl.enable(gl.BLEND);
            gl.depthMask(false);

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            let shader = complex ? complex_flame_shader : flame_shader;

            gl.useProgram(shader.shader);

            gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
            gl.enableVertexAttribArray(shader.attributes["v_position"]);
            gl.vertexAttribPointer(shader.attributes["v_position"], 3, gl.FLOAT, false, 24, 0);

            gl.uniformMatrix4fv(shader.uniforms["m_m"], false, mat4_transpose(m));
            gl.uniformMatrix4fv(shader.uniforms["m_mvp"], false, mat4_transpose(mvp));

            gl.uniform3fv(shader.uniforms["dir"], vec_scale(dir, march_step));

            gl.uniform4fv(shader.uniforms["params"], params);
            gl.uniform4fv(shader.uniforms["pre_color"], pre_color);
            gl.uniform4fv(shader.uniforms["post_color"], post_color);
            gl.uniform4fv(shader.uniforms["f0_color"], f0_color);
            gl.uniform4fv(shader.uniforms["f1_color"], f1_color);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);

            if (complex) {

                let mesh = models["Chamber_top"];
                gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, mesh.index_offset * 4);


            } else {
                let mesh = models["Fuel"];
                gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, mesh.index_offset * 4);
            }

        }


        this.finish = function () {
            gl.flush();
            return gl.canvas;
        }
    }


    let gl = new GLDrawer(scale, function () {
        models_ready = true;
        xs_ready = true;
        all_drawers.forEach(drawer => drawer.repaint())
    });


    function Drawer(container, mode) {

        let self = this;

        all_drawers.push(self);
        all_containers.push(container);
        container.drawer = this;


        let wrapper = document.createElement("div");
        wrapper.classList.add("canvas_container");
        wrapper.classList.add("non_selectable");

        let canvas = document.createElement("canvas");
        canvas.classList.add("non_selectable");
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";


        wrapper.appendChild(canvas);

        container.appendChild(wrapper);

        var play = document.createElement("div");
        play.classList.add("play_pause_button");
        play.classList.add("playing");


        this.paused = true;
        this.requested_repaint = false;


        let size_height_factor = 1.0;


        this.set_paused = function (p) {
            self.paused = p;

            if (self.paused) {
                play.classList.remove("playing");
            } else {
                play.classList.add("playing");
                window.requestAnimationFrame(tick);
            }
        }


        let t = 0;
        let time = 0;
        let time_frac = 0;


        let time_idx_back = 240;
        let time_idx_forward = 60;
        let max_speed = 20


        let time_idx_skip_back = time_idx_back + points_hist_n;
        let time_idx_skip_forward = time_idx_forward + points_hist_n;


        let time_idx = time_idx_skip_back; // first time to show should be >0 to calc historical data
        let timeDay = time_idx_skip_back;
        let prev_timestamp;


        function tick(timestamp) {


            var rect = canvas.getBoundingClientRect();

            var wh = window.innerHeight || document.documentElement.clientHeight;
            var ww = window.innerWidth || document.documentElement.clientWidth;
            if (!(rect.top > wh || rect.bottom < 0 || rect.left > ww || rect.right < 0)) {

                let dt = 0;

                if (prev_timestamp)
                    dt = (timestamp - prev_timestamp) / 1000;


                t += dt;
                time += dt;
                time_step = dt;


                if (time_frac > spf) {
                    time_frac = 0;
                    self.repaint(time_frac);

                } else {
                    time_frac += dt;
                }
            }

            prev_timestamp = timestamp;

            if (self.paused)
                prev_timestamp = undefined;
            else
                window.requestAnimationFrame(tick);


        }

        play.onclick = function () {
            self.set_paused(!self.paused);
        }

        let track_drags = mode === "map0";

        let animated = mode === "scatter_viz" || mode === "fin_data_scatter1";


        let load_text = true;

        let ss_drag = mode === "";

        let left_camera_pans = mode === "";

        let no_camera_pans = mode === "";

        let arcball_mode = mode === "scatter_viz1";

        let two_axis_mode = mode === "reactor_base";


        let no_drag = mode === "";


        let arcball;
        let two_axis;

        // animated
        if (animated) {
            this.paused = false;
            wrapper.appendChild(play);
            window.requestAnimationFrame(tick);
        }


        let width, height;

        let rot_model = ident_mat4;

        let rot = ident_matrix.slice();
        // rot = mat3_mul(rot_x_mat3(-0.4), rot_y_mat3(pi));
        // rot = mat3_mul(rot_y_mat3(0.4), rot);


        rot = mat3_mul(rot_x_mat3(0), rot_y_mat3(0));
        rot = mat3_mul(rot_y_mat3(0), rot);


        if (two_axis_mode) {
            rot = mat3_mul(rot_x_mat3(-0.7), rot_z_mat3(-0.7));

            two_axis = new TwoAxis();
            two_axis.set_angles([-0.7, -0.7]);
            two_axis.set_vertical_limits([-pi / 2, -0.0]);
            two_axis.set_callback(function () {
                rot = two_axis.matrix.slice();
                request_repaint();
            });
        } else if (arcball_mode) {
            arcball = new ArcBall(rot, function () {
                rot = arcball.matrix.slice();
                request_repaint();
            });
        }


        function canvas_space(e) {
            let r = canvas.getBoundingClientRect();
            return [width - (e.clientX - r.left), (e.clientY - r.top)];
        }

        let start = [0, 0];
        let oob_drag = false;
        let dragging = false;
        let drag_delta = [0, 0];


        function request_repaint() {
            if (self.paused && !self.requested_repaint) {
                self.requested_repaint = true;
                window.requestAnimationFrame(function () {
                    self.repaint();
                });
            }
        }


        if (!no_drag) {
            container.classList.add("move_cursor");

            new TouchHandler(canvas,
                function (e) {
                    let p = canvas_space(e);
                    oob_drag = false;

                    if (left_camera_pans && p[0] > width * 0.5) {
                        oob_drag = true;
                        return false;
                    }

                    if (track_drags && hit_test(p)) {
                        dragging = true;
                        drag_delta = vec_sub(p, ss_point);
                        canvas.style.cursor = "grabbing";
                    } else if (no_camera_pans) {

                        oob_drag = true;
                        return false;
                    } else if (two_axis) {
                        two_axis.start(p[0], p[1]);
                    } else if (arcball) {
                        arcball.start(p[0], p[1]);
                    }

                    start = p;

                    return true;
                },
                function (e) {
                    let p = canvas_space(e);


                    if (dragging) {

                        if (ss_drag) {
                            ss_point = vec_sub(p, drag_delta);
                        } else {
                            point = limit(point, p, drag_delta);
                        }

                        request_repaint();
                    } else if (oob_drag) {
                        return false;
                    } else if (two_axis) {
                        two_axis.update(p[0], p[1], e.timeStamp);
                        rot = two_axis.matrix.slice();
                        request_repaint();
                    } else if (arcball) {
                        arcball.update(p[0], p[1], e.timeStamp);
                        rot = arcball.matrix.slice();
                        request_repaint();
                    }

                    return true;
                },
                function (e) {
                    let p = canvas_space(e);

                    if (dragging) {
                        dragging = false;

                        if (simulated) self.set_paused(false);

                        if (hit_test(p)) {
                            canvas.style.cursor = "grab";
                        } else {
                            canvas.style.cursor = "default";
                        }
                    }

                    if (oob_drag)
                        ;
                    else if (two_axis)
                        two_axis.end(e.timeStamp);
                    else if (arcball)
                        arcball.end(e.timeStamp);

                });
        }


        let arg0 = 0, arg1 = 0, arg2 = 0, arg3 = 0, arg4 = 0, arg5 = 0;

        let tog1 = false, tog2 = false, tog3 = true;

        let event0 = [0, 0, 0];


        this.get_arg0 = function () {
            return arg0;
        }
        this.set_arg0 = function (x) {
            arg0 = x;
            request_repaint();
        }
        this.set_arg1 = function (x) {
            arg1 = x;
            request_repaint();
        }
        this.set_arg2 = function (x) {
            arg2 = x;
            request_repaint();
        }
        this.set_arg3 = function (x) {
            arg3 = x;
            request_repaint();
        }
        this.set_arg4 = function (x) {
            arg4 = x;
            request_repaint();
        }
        this.set_arg5 = function (x) {
            arg5 = x;
            request_repaint();
        }
        this.set_tog1 = function (x) {
            tog1 = !tog1;
            request_repaint();
        }
        this.set_tog2 = function (x) {
            tog2 = !tog2;
            request_repaint();
        }
        this.set_tog3 = function (x) {
            tog3 = !tog3;
            request_repaint();
        }

        this.start_event0 = function (x, y) {
            event0 = [1, x, y];
            request_repaint();

        }

        this.set_rot = function (x) {
            rot = x;

            if (arcball)
                arcball.set_matrix(x);

            request_repaint();
        }

        this.set_point = function (x) {
            point = x;
            request_repaint();
        }


        this.set_visible = function (x) {
            this.visible = x;
            if (x && !this.was_drawn)
                request_repaint();
        }


        let aspect = width / height;

        let proj_w;
        let proj_h;

        let proj;

        let ortho_scale = 1.3;
        let ortho_proj = ident_mat4.slice();


        ortho_proj[0] = ortho_scale;
        ortho_proj[5] = ortho_scale;
        ortho_proj[10] = -0.3;


        let x_flip = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
        let y_flip = [1, 0, 0, 0, -1, 0, 0, 0, 1];


        function project(p) {
            let s = -0.001;
            let z = (1.0 + p[2] * s);
            return [p[0] / z, p[1] / z, -z];
        }

        function project2(p) {
            p = vec_scale(p, height / 4.0);
            p[1] = -p[1];
            return p;
        }


        function ray_project_norm(p) {

            let fov_start = 2.4142135624;
            let camera_dist = 10.0;
            p = p.slice();
            p[2] -= camera_dist;

            let z = p[2] / fov_start;
            return [p[0] / z, p[1] / z, -z];
        }

        function ray_project(p) {

            let fov_start = 2.4142135624;
            let camera_dist = 10.0;
            p = p.slice();
            p[2] -= camera_dist;

            let z = p[2] / fov_start;
            p = vec_scale(p, height * 0.5);
            return [p[0] / z, p[1] / z, -z];
        }

        function ray_project_fov(p, fov_start, camera_dist) {
            // let fov_start = 2.4142135624;
            //           let camera_dist = 10.0;
            p = p.slice();
            p[2] -= camera_dist;

            let z = p[2] / fov_start;
            p = vec_scale(p, height * 0.5);
            return [p[0] / z, p[1] / z, -z];
        }


        this.on_resize = function () {
            let new_width = wrapper.clientWidth;
            let new_height = wrapper.clientHeight;

            if (new_width != width || new_height != height) {

                width = new_width;
                height = new_height;

                canvas.style.width = width + "px";
                canvas.style.height = height + "px";
                canvas.width = width * scale;
                canvas.height = height * scale;

                aspect = width / height;

                proj_w = 1500;
                proj_h = proj_w / aspect;

                proj = [1 / proj_w, 0, 0, 0,
                    0, 1 / proj_h, 0, 0,
                    0, 0, -0.00015, 0,
                    0, 0, 0, 1]

                let pad = 5;
                let a_size = Math.max(width, height) - pad * 2;

                if (two_axis)
                    two_axis.set_size([a_size, a_size]);
                else if (arcball)
                    arcball.set_viewport(width / 2 - a_size / 2 + pad,
                        height / 2 - a_size / 2 + pad,
                        a_size, a_size);

                request_repaint();
            }
        }


        this.repaint = function (dt) {

            self.requested_repaint = false;

            let ctx = canvas.getContext("2d");

            ctx.resetTransform();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            font_size = 21;

            if (window.innerWidth < 500)
                font_size = 18;

            if (window.innerWidth < 400)
                font_size = 16;

            ctx.font = font_size + "px Atkinson Hyperlegible";
            ctx.textAlign = "center";
            ctx.globalAlpha = 1.0;


            if (!xs_ready) {
                ctx.fillStyle = "#666";
                ctx.translate(width * 0.5, height * 0.5);
                ctx.fillText("Loading...", 0, 0);
                return;
            }

            function drawAxis(axis, label, top_pad, ph, pw, height, side_pad, min_x, max_x, min_y, max_y) {

                function compxy_xy_l(x0, y0) {
                    let tt = (x0 - min_x) / (max_x - min_x);
                    let x = side_pad + tt * (pw);
                    let tty = (y0 - min_y) / (max_y - min_y);
                    let y = top_pad + ph * (1 - tty);
                    return [x, y];
                }

                let min_axis = (axis === 'x') ? min_x : min_y;
                let max_axis = (axis === 'x') ? max_x : max_y;

                let symmetric = true;
                if (symmetric) {
                    min_axis = -Math.min(Math.abs(min_axis), Math.abs(max_axis));
                    max_axis = Math.min(Math.abs(min_axis), Math.abs(max_axis));
                }

                let sep = Math.max(.1, Math.floor((max_axis - min_axis) / 4 / 0.5) * 0.5);

                let ticks = Math.floor((max_axis - min_axis) / sep);
                // odd number of ticks to straddle 0
                ticks = Math.floor(ticks / 2) * 2 + 1;
                let tick_marks = [];

                for (let i = 1; i < ticks - 1; i++) {
                    let val = (Math.ceil(min_axis / sep) + i) * sep;
                    tick_marks.push(val);
                }

                for (let i = 0; i < tick_marks.length; i++) {
                    let pp;
                    if (axis === 'x') {
                        pp = compxy_xy_l(tick_marks[i], min_y);
                    } else {
                        pp = compxy_xy_l(min_x, tick_marks[i], min_x);
                    }

                    ctx.beginPath();
                    ctx.lineWidth = 2.0;
                    ctx.strokeStyle = "#666";
                    ctx.fillStyle = "#666";
                    ctx.textAlign = "center";
                    ctx.font = Math.floor(font_size * 0.4) + "px Atkinson Hyperlegible";

                    if (axis === 'x') {
                        ctx.moveTo(pp[0], top_pad + ph * (1 - .01));
                        ctx.lineTo(pp[0], top_pad + ph * (1 + .01));
                        ctx.fillText(tick_marks[i].toPrecision(2), pp[0] - font_size * .0, top_pad + ph * (1 + .01) + font_size * .4);
                    } else {
                        ctx.textAlign = "right";

                        ctx.moveTo(side_pad + pw * (.1 - .01), pp[1]);
                        ctx.lineTo(side_pad + pw * (0.1 + .01), pp[1]);
                        ctx.fillText(tick_marks[i].toPrecision(2), side_pad + pw * (0.1 - .02), pp[1] + font_size * 0.1);
                    }
                    ctx.stroke();

                    // Draw tiny ticks
                    ctx.beginPath();
                    ctx.lineWidth = 1.0;
                    if (i < tick_marks.length - 1) {
                        for (let j = 0; j < 10; j++) {
                            if (axis === 'x') {
                                pp = compxy_xy_l(lerp(tick_marks[i], tick_marks[i + 1], j / 10), min_y);
                                ctx.moveTo(pp[0], top_pad + ph * (1 - .005));
                                ctx.lineTo(pp[0], top_pad + ph * (1 + .005));
                            } else {
                                pp = compxy_xy_l(min_x, lerp(tick_marks[i], tick_marks[i + 1], j / 10), min_x);
                                ctx.moveTo(side_pad + pw * (0.1 - .005), pp[1]);
                                ctx.lineTo(side_pad + pw * (0.1 + .005), pp[1]);
                            }
                        }
                        ctx.stroke();

                    }
                }

                ctx.restore()
                ctx.save()

                // Label for axis
                ctx.beginPath();
                ctx.strokeStyle = "#666";
                ctx.fillStyle = "#666";
                if (axis === 'y') {
                    ctx.translate(side_pad + font_size * .5, top_pad + ph * 0.5);
                    ctx.rotate(-Math.PI / 2); // Rotate -90 degrees
                } else {
                    ctx.translate(side_pad + .5 * pw, top_pad + ph * (1 + .01) + font_size * 1.4);
                }

                ctx.font = Math.floor(font_size * 0.6) + "px Atkinson Hyperlegible";
                ctx.fillText(label, 0, 0);

                // ctx.fillText(label, pw * 0.5 + side_pad,  height - font_size * 1.3);

                ctx.stroke();
                ctx.restore();
                ctx.save();
            }


            function draw_plane(proj_rot, b, fill, stroke, force_fill) {

                ctx.fillStyle = fill || "#000";
                ctx.strokeStyle = stroke || "#282828";


                b *= 0.5;
                ctx.beginPath();

                let p = [-b, -b, 0];
                p = ray_project(mat3_mul_vec(proj_rot, p));
                ctx.moveTo(p[0], p[1]);

                p = [b, -b, 0];
                p = ray_project(mat3_mul_vec(proj_rot, p));
                ctx.lineTo(p[0], p[1]);

                p = [b, b, 0];
                p = ray_project(mat3_mul_vec(proj_rot, p));
                ctx.lineTo(p[0], p[1]);

                p = [-b, b, 0];
                p = ray_project(mat3_mul_vec(proj_rot, p));
                ctx.lineTo(p[0], p[1]);
                ctx.closePath();


                // if (mvp[8] < 0.0 || force_fill)
                //     ctx.fill();

                ctx.stroke();
            }


            if (mode === "test") {


            } else if (mode === "scatter_viz") {

                ctx.save()


                // live return calculation compared to entry arg2 days ago
                let timeago_x = Math.floor(lerp(-time_idx_forward, time_idx_back, arg2));
                let timeago_y = Math.floor(lerp(-time_idx_forward, time_idx_back, arg5));


                let forward_days = Math.max(-1 * Math.min(timeago_x, timeago_y), 0);


                let t_dir = (arg1 - .5) > 0 ? 1 : -1;
                let speed0 = t_dir * (Math.abs(arg1 - .5) * 2) ** 2 * max_speed;

                let fpd =t_dir* 1 / lerp(0, 1, (arg1-.5)**2) / 10; //2.5 * (1 / (arg1 + .5)) ** 6; // frames per day

                timeDay += 1 / fpd;

                let fracDay;

                fracDay = t_dir > 0 ? timeDay - Math.floor(timeDay) : Math.ceil(timeDay) - timeDay;

                // fracDay = timeDay - Math.floor(timeDay);

                let day_bool;
                if (true) {
                    day_bool = fracDay > 1 - Math.abs(1 / fpd);
                } else {
                    day_bool = fracDay < Math.abs(1 / fpd);
                }

                if (1 == 0) {
                    time_idx = Math.round(lerp(0, xs_nuke["Data"].length - 1, arg1));
                } else {

                    // let speed0 = 0;

                    // spf =1/lerp(1,100,arg1)

                    // time_idx = t_dir > 0 ? Math.floor(timeDay) : Math.ceil(timeDay);
                    time_idx = Math.floor(timeDay);


                    if (time_idx > xs_nuke["Data"].length - time_idx_skip_forward) {
                        time_idx = time_idx_skip_back + 1;
                        timeDay = time_idx_skip_back + 1;

                    } else if (time_idx < time_idx_skip_back) {
                        time_idx = xs_nuke["Data"].length - time_idx_skip_forward;
                        timeDay = xs_nuke["Data"].length - time_idx_skip_forward;
                    }
                }


                let side_pad = font_size * 1.5;
                let bottom_pad = font_size * 3.5;
                let top_pad = font_size * 2;
                let pw = width - side_pad;
                let ph = height - top_pad - bottom_pad;

                let title = xs_nuke["Data"][time_idx][0][xs_nuke["Columns"]["Date"]];
                ctx.font = Math.floor(font_size * .6) + "px Atkinson Hyperlegible";
                ctx.fillStyle = "#666";
                ctx.textAlign = "left";

                let title_split = title.split(" ");
                ctx.fillText(title_split[0], pw * 1 - side_pad - font_size * 4, top_pad + ph - font_size * 1.3);

                ctx.restore();
                ctx.save();
                ctx.font = Math.floor(font_size * 0.8) + "px Atkinson Hyperlegible";

                let idx = [
                    0, 0,
                    xs_nuke["Columns"]["+1 Month Change"], xs_nuke["Columns"]["Market Cap"],
                    xs_nuke["Columns"]["Close MA"],
                ];

                // let idx = [
                //     xs_nuke["Columns"]["1 Month Change"], xs_nuke["Columns"]["1 Year Change"],
                //     xs_nuke["Columns"]["+1 Month Change"], xs_nuke["Columns"]["Market Cap"],
                //     xs_nuke["Columns"]["Close MA"], xs_nuke["Columns"]["Close"],
                // ];


                let idx_c = xs_nuke["Columns"]["Sector"]
                let idx_tick = xs_nuke["Columns"]["Ticker"]
                let idx_vol = xs_nuke["Columns"]["Volume"]

                ctx.font = Math.floor(font_size * 0.8) + "px IBM Plex Sans";

                // how many colors in sector colors
                let color_LUT = xs_nuke["Sector Colors"];
                let color_len = Object.keys(color_LUT).length;
                let box_w = 10;
                let box_h = font_size * .8;
                let i = 0;
                ctx.font = Math.floor(font_size * 0.5) + "px Atkinson Hyperlegible";
                ctx.textAlign = "right";

                for (const property in color_LUT) {
                    ctx.fillStyle = `rgb(${color_LUT[property][0] * 255}, ${color_LUT[property][1] * 255}, ${color_LUT[property][2] * 255})`;
                    ctx.fillRect(width - box_w - font_size * 1.5, top_pad + (i) * box_h, box_w, box_h);
                    ctx.fillStyle = "#666";
                    ctx.fillText(`${property}`, width - box_w - font_size * 1.7, top_pad + (i + 0.65) * box_h);
                    i += 1;
                }

                // ctx.fillText("Speed: " + (1 / fpd).toPrecision(3) + "", pw * .8, font_size * 3.3);

                let timeago_x_idx = Math.max(0, time_idx - timeago_x);
                let timeago_y_idx = Math.max(0, time_idx - timeago_y);


                // imposed scale
                let imposed_scale = lerp(2, .3, arg0);
                let max_x = current_scale[0] * imposed_scale;
                let min_x = -current_scale[0] * imposed_scale;
                let max_y = current_scale[1] * imposed_scale;
                let min_y = -current_scale[1] * imposed_scale;
                let xlabel, ylabel;

                let xsign = timeago_x < 0 ? -1 : 1;
                let ysign = timeago_y < 0 ? -1 : 1;

                xlabel = (timeago_x < 0 ? "Future " : "Past ") + Math.abs(timeago_x) + " day return";
                ylabel = (timeago_y < 0 ? "Future " : "Past ") + Math.abs(timeago_y) + " day return";
ctx.restore();
ctx.save();
                drawAxis('x', xlabel, top_pad, ph, pw, height, side_pad, min_x, max_x, min_y, max_y);
                drawAxis('y', ylabel, top_pad, ph, pw, height, side_pad, min_x, max_x, min_y, max_y);


                function compxy_xy(x0, y0) {
                    let tt = (x0 - min_x) / (max_x - min_x);
                    let x = side_pad + tt * (pw);
                    let tty = (y0 - min_y) / (max_y - min_y);
                    let y = top_pad + ph * (1 - tty);
                    return [x, y];
                }


                target_scale = [0, 0, 0];
                let xcoord, ycoord;

                let ddd, ddd_ago_x, ddd_ago_y;
                let c_light = [0.5, 0.5, 0.5, .1];

                for (let i = 0; i < n_points; i++) {
                    ddd = xs_nuke["Data"][time_idx][i];
                    ddd_ago_x = xs_nuke["Data"][timeago_x_idx][i];
                    ddd_ago_y = xs_nuke["Data"][timeago_y_idx][i];
                    if (ddd[idx_vol] > 0 && tog3) {


                        let xy_canbas, xy_canbas_last;


                        xcoord = xsign * (ddd[idx[4]] - ddd_ago_x[idx[4]]) / ddd[idx[4]];
                        ycoord = ysign * (ddd[idx[4]] - ddd_ago_y[idx[4]]) / ddd[idx[4]];

                        if (Math.abs(xcoord) > target_scale[0]) target_scale[0] = Math.abs(xcoord);
                        if (Math.abs(ycoord) > target_scale[1]) target_scale[1] = Math.abs(ycoord);


                        let pppp = compxy_xy(xcoord / current_scale[0], ycoord / current_scale[1]);
                        let pppp_prev = compxy_xy(points_prev[i].x / current_scale[0], points_prev[i].y / current_scale[1]);


                        // interpolate
                        xcoord_c = lerp(pppp_prev[0], pppp[0], fracDay);
                        ycoord_c = lerp(pppp_prev[1], pppp[1], fracDay);

                        // time_idx-time_idx_skip_back > points_hist_n
                        if (t_dir > 0 && true) {

                            ctx.lineWidth = 1;
                            // ctx.strokeStyle = rgba_color_string(c_light);

                            line_pointsX = points_histX[i];
                            line_pointsY = points_histY[i];



                            let real_points = Math.min(time_idx - time_idx_skip_back, points_hist_n);

                            for (let j = points_hist_n - 1; j > points_hist_n - real_points; j--) {
                                c_light = [0.5, 0.5, 0.5, lerp(0,.5,(j/(points_hist_n)))**1.5];

                                ctx.strokeStyle = rgba_color_string(c_light);
                                ctx.beginPath();

                                xy_canbas = compxy_xy(line_pointsX[j] / current_scale[0], line_pointsY[j] / current_scale[1]);

                                ctx.lineTo(xcoord_c, ycoord_c);
                                ctx.lineTo(xy_canbas[0], xy_canbas[1]);


                                xcoord_c = xy_canbas[0];
                                ycoord_c = xy_canbas[1];
                                if (j === points_hist_n - real_points + 1) {
                                    xy_canbas_last = compxy_xy(line_pointsX[points_hist_n - real_points] / current_scale[0], line_pointsY[points_hist_n - real_points] / current_scale[1]);
                                    ctx.lineTo(lerp(xy_canbas_last[0], xy_canbas[0], fracDay), lerp(xy_canbas_last[1], xy_canbas[1], fracDay));

                                }




                                ctx.stroke();

                            }

                            // interpolate for the last point using fracDay

                            ctx.stroke();
                            ctx.restore();


                        }

                        // ctx.fillStyle = rgba_color_string(c);
                        // ctx.strokeStyle = rgba_color_string(c);
                        // ctx.fillEllipse(xcoord_c, ycoord_c, lerp(points_prev[i].rr, rr, fracDay));
                        // ctx.strokeEllipse(xcoord_c, ycoord_c, lerp(points_prev[i].rr, rr, fracDay));
                        // ctx.stroke()


                    }


                }

                for (let i = 0; i < n_points; i++) {
                    ddd = xs_nuke["Data"][time_idx][i];
                    ddd_ago_x = xs_nuke["Data"][timeago_x_idx][i];
                    ddd_ago_y = xs_nuke["Data"][timeago_y_idx][i];

                    let c, rr;
                    if (ddd[idx_vol] > 0 || 1 === 0) {


                        // let c = [Math.random(), Math.random(), Math.random(), 1.0];
                        let z = -ddd[idx[2]] / current_scale[2];

                        if (arg3 == 1) {
                            c = vec_lerp(red_color, green_color, clamp(z * 3 + .5, 0, 1));
                        } else {
                            c = xs_nuke["Sector Colors"][ddd[idx_c]];
                        }


                        let rr_q = (arg4 === 0) ? ddd[idx[3]] : Math.abs(ddd[idx[2]]) * 7;


                        if (tog1) {
                            rr = lerp(2, 12, clamp(Math.log10(rr_q), 0, 1));

                        } else {
                            rr = lerp(2, 12, clamp(rr_q / 4, 0, 1));

                        }


                        // xcoord = xsign * (ddd[idx[4]] / ddd_ago_x[idx[4]] - 1);
                        // ycoord = ysign * (ddd[idx[4]] / ddd_ago_y[idx[4]] - 1);

                        xcoord = xsign * (ddd[idx[4]] - ddd_ago_x[idx[4]]) / ddd[idx[4]];
                        ycoord = ysign * (ddd[idx[4]] - ddd_ago_y[idx[4]]) / ddd[idx[4]];
                        // xcoord = ddd[idx[0]];
                        // ycoord = ddd[idx[2]];

                        if (Math.abs(xcoord / current_scale[0]) > target_scale[0]) target_scale[0] = Math.abs(xcoord / current_scale[0]);
                        if (Math.abs(ycoord / current_scale[1]) > target_scale[1]) target_scale[1] = Math.abs(ycoord / current_scale[1]);


                        let pppp = compxy_xy(xcoord / current_scale[0], ycoord / current_scale[1]);
                        let pppp_prev = compxy_xy(points_prev[i].x / current_scale[0], points_prev[i].y / current_scale[1]);

                        if (true) {
                            xcoord_c = lerp(pppp_prev[0], pppp[0], fracDay);
                            ycoord_c = lerp(pppp_prev[1], pppp[1], fracDay);
                        } else {
                            xcoord_c = pppp[0];
                            ycoord_c = pppp[1];
                        }
                        ctx.fillStyle = rgba_color_string(c);
                        ctx.strokeStyle = rgba_color_string(white_color);

                        ctx.lineWidth = .3;

                        ctx.fillEllipse(xcoord_c, ycoord_c, lerp(points_prev[i].rr, rr, fracDay));
                        ctx.strokeEllipse(xcoord_c, ycoord_c, lerp(points_prev[i].rr, rr, fracDay));

                        ctx.stroke()
                        ctx.restore();
                        ctx.save()

                        // add text label

                        if (tog2) {
                            ctx.font = Math.floor(font_size * 0.3) + "px Atkinson Hyperlegible";
                            ctx.textAlign = "left";
                            ctx.fillStyle = "#666";
                            ctx.fillText(ddd[idx_tick], xcoord_c + font_size * 0.1+rr*.71, ycoord_c - font_size * 0.1-rr*.71);
                            ctx.restore();
                            ctx.save();
                        }

                        // if day_bool == 1, then we are on a new day, so update points_prev
                        if (day_bool) {
                            points_prev[i] = {x: xcoord, y: ycoord, c: c, rr: rr};
                            points_histX[i].shift();
                            points_histX[i].push(xcoord);
                            points_histY[i].shift();
                            points_histY[i].push(ycoord);

                        }

                    }

                }

                ctx.restore();
                ctx.save();

                // values of target scale at most 10 and at least .25
                // target_scale[0] = Math.min(target_scale[0], .75);
                // target_scale[1] = Math.min(target_scale[1], .75);
                // target_scale[0] = Math.max(target_scale[0], .25);
                // target_scale[1] = Math.max(target_scale[1], .25);
                target_scale[2] = 1;

                let scale_change_rate = 0;
                current_scale = vec_lerp(current_scale, target_scale, scale_change_rate);

                ctx.save();

                ctx.drawImage(gl.finish(), 0, 0, width, height);
                ctx.feather(width * scale, height * scale,
                    canvas.height * 0.08, canvas.height * 0.08,
                    canvas.height * 0.08, canvas.height * 0.08);

            }


        }

        if (animated)
            this.set_paused(false);


        if (load_text)
            document.fonts.load("10px Atkinson Hyperlegible").then(function () {
                self.repaint()
            });

        this.on_resize();

        window.addEventListener("resize", this.on_resize, true);
        window.addEventListener("load", this.on_resize, true);
    }


    document.addEventListener("DOMContentLoaded", function (event) {

        var toggles = document.querySelectorAll('.toggle-toggle-switch input[type="checkbox"]');


        // let fin_data_scatter1 = new Drawer(document.getElementById("fin_data_scatter1"), "fin_data_scatter1");
        // new Slider(document.getElementById("fin_data_scatter1_sl0"), function (x) {
        //     fin_data_scatter1.set_arg0(x);
        // }, undefined, .5);
        // new Slider(document.getElementById("fin_data_scatter1_sl1"), function (x) {
        //     fin_data_scatter1.set_arg1(x);
        // }, undefined, 1);
        // let fin_data_scatter1_c = document.getElementById("fin_data_scatter1");
        // fin_data_scatter1_c.onclick = function (e) {
        //     fin_data_scatter1.start_event0(e.clientX, e.clientY)
        // }
        // new SegmentedControl(document.getElementById("fin_data_scatter1_seg1"), function (x) {
        //     fin_data_scatter1.set_arg2(x);
        // }, ["Fission", "Scattering", "Absorption"]);
        //
        // new SegmentedControl(document.getElementById("fin_data_scatter1_seg0"), function (x) {
        //     fin_data_scatter1.set_arg3(x);
        // }, ["Energy", "Velocity"]);

        toggles.forEach(function (toggle) {
            toggle.addEventListener('change', function () {
                if (this.id === 'tog1') {
                    scatter_viz.set_tog1(); // Call set_tog1 when toggle1 is changed
                } else if (this.id === 'tog2') {
                    scatter_viz.set_tog2(); // Call set_tog2 when toggle2 is changed
                } else if (this.id === 'tog3') {
                    scatter_viz.set_tog3(); // Call set_tog2 when toggle2 is changed
                }
            });
        });

        let scatter_viz = new Drawer(document.getElementById("scatter_viz"), "scatter_viz");
        new Slider(document.getElementById("scatter_viz_sl0"), function (x) {
            scatter_viz.set_arg0(x);
        }, undefined, 0.2);
        new Slider(document.getElementById("scatter_viz_sl1"), function (x) {
            scatter_viz.set_arg1(x);
        }, undefined, .8);

        new Slider(document.getElementById("scatter_viz_sl2"), function (x) {
            scatter_viz.set_arg2(x);
        }, undefined, .5);
        new Slider(document.getElementById("scatter_viz_sl3"), function (x) {
            scatter_viz.set_arg5(x);
        }, undefined, .3);
        new SegmentedControlVert(document.getElementById("scatter_viz_seg0"), function (x) {
            scatter_viz.set_arg3(x);
        }, ["Sector", "+1 Month Change",]);
        new SegmentedControlVert(document.getElementById("scatter_viz_seg1"), function (x) {
            scatter_viz.set_arg4(x);
        }, ["Market Cap", "+1 Month Change",]);


        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    entry.target.drawer.set_visible(entry.isIntersecting);
                })
            }, {rootMargin: "100px"})

            all_containers.forEach(container => observer.observe(container));
        } else {
            all_containers.forEach(container => container.drawer.set_visible(true));
        }

    });

})
();