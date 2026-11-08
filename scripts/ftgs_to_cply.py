#!/usr/bin/env python3
"""
Convert a FreeTimeGS ".ftgs.ply" into 4D compressed PLY files (".c.ply") that
Spark's `examples/4dgs` page can play.

Input : the single-file export of FreeTimeGsVanilla
        (https://github.com/OpsiClear-4DGS/FreeTimeGsVanilla, layout "FTGS PLY
        version 1": every property is a 32-bit float, time is normalized to 0..1).
Output: SuperSplat/PlayCanvas "compressed PLY" (chunks of 256 splats with
        packed_position / packed_rotation / packed_scale / packed_color) plus
        two extra per-splat fields and the matching per-chunk min/max values:

          packed_motion  velocity, 11-10-11 bits (x, y, z), per-chunk min/max
          packed_time    bits 31..21: ln(temporal sigma), 11 bits, per-chunk min/max
                         bits 20..11: time center, 10 bits, per-chunk min/max

At time t (in the file's local time, in seconds) a splat is drawn at

    position = position + velocity * (t - time_center)
    alpha    = opacity * exp(-0.5 * ((t - time_center) / sigma) ** 2)

Long clips can be split into several files (--chunk-seconds); every file covers
a fixed time window and contains the splats that are visible in that window, so
a player only has to keep one or two files in memory.

Only the DC spherical harmonic band (view independent color) is kept.
No code of FreeTimeGsVanilla is used here; only its documented file layout.

Examples
    # a short clip, one file; duration = (n_frames - 1) / fps
    python scripts/ftgs_to_cply.py scene.ftgs.ply 00.c.ply --fps 30 --zup --ground --fit-height 1.7

    # a long clip, 5 second files written to ./clip/00.c.ply, 01.c.ply, ...
    python scripts/ftgs_to_cply.py scene.ftgs.ply ./clip --fps 30 --chunk-seconds 5 --zup --ground

    # check that the writer and Spark's decoder agree (no input needed)
    python scripts/ftgs_to_cply.py --self-test
"""
import argparse
import math
import os
import re
import sys
import tempfile

import numpy as np

SH_C0 = 0.28209479177387814
CHUNK = 256


# reading
def read_ftgs_ply(path):
    """Read a .ftgs.ply. Returns (structured float32 array, dict of header comments)."""
    with open(path, "rb") as f:
        header = []
        while True:
            line = f.readline()
            if not line:
                raise ValueError("No 'end_header' found: is this a .ftgs.ply file?")
            s = line.decode("ascii", "replace").strip()
            header.append(s)
            if s == "end_header":
                break
        data = f.read()
    if not any(h.startswith("format binary_little_endian") for h in header):
        raise ValueError("Expected a binary_little_endian PLY")
    props, count, in_vertex, meta = [], None, False, {}
    for h in header:
        t = h.split()
        if not t:
            continue
        if t[0] == "element":
            in_vertex = t[1] == "vertex"
            if in_vertex:
                count = int(t[2])
        elif t[0] == "property" and in_vertex:
            if t[1] not in ("float", "float32"):
                raise ValueError(f"Property {t[2]} is {t[1]}; FTGS PLY v1 only has float32")
            props.append(t[2])
        elif t[0] == "comment":
            m = re.match(r"comment\s+([A-Za-z_][\w]*)[\s=:]+(\S+)", h)
            if m:
                meta[m.group(1)] = m.group(2)
    arr = np.frombuffer(data, dtype=np.dtype([(p, "<f4") for p in props]), count=count)
    need = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3", "time", "log_duration"]
    missing = [k for k in need if k not in props]
    if missing:
        raise ValueError(f"Missing properties: {missing}")
    return arr, meta


# quaternion helpers
# Internally quaternions are (x, y, z, w). FTGS stores (w, x, y, z); Spark's packed
# rotation uses the (w, x, y, z) order, see pack_rotation().
def quat_axis(axis, deg):
    h = math.radians(deg) / 2.0
    q = np.zeros(4)
    q[axis] = math.sin(h)
    q[3] = math.cos(h)
    return q


def quat_mul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], axis=-1)


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


# packing
def unorm(x, bits):
    top = (1 << bits) - 1
    return np.clip(np.floor(x * top + 0.5), 0, top).astype(np.uint32)


def normalize(x, lo, hi):
    rng = hi - lo
    out = np.zeros_like(x, dtype=np.float64)
    ok = rng > 1e-5
    out[ok] = (x[ok] - lo[ok]) / rng[ok]
    return np.clip(out, 0.0, 1.0)


def pack_111011(nx, ny, nz):
    return (unorm(nx, 11) << 21) | (unorm(ny, 10) << 11) | unorm(nz, 11)


def pack_rotation(q_xyzw):
    """Smallest-three packing as Spark decodes it (rust/spark-lib/src/ply.rs).

    The 2 top bits hold the index of the largest component in (w, x, y, z)
    order; the other three, in that order, are stored in 10 bits each.
    """
    q = q_xyzw[:, [3, 0, 1, 2]]                      # (w, x, y, z)
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    idx = np.argmax(np.abs(q), axis=1)
    rows = np.arange(len(q))
    q = q * np.where(q[rows, idx] < 0, -1.0, 1.0)[:, None]
    others = np.array([[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]])[idx]
    v = np.take_along_axis(q, others, axis=1) * (math.sqrt(2.0) * 0.5) + 0.5
    return ((idx.astype(np.uint32) << 30) | (unorm(v[:, 0], 10) << 20)
            | (unorm(v[:, 1], 10) << 10) | unorm(v[:, 2], 10))


def _part1by2(x):
    x = x.astype(np.uint64) & np.uint64(0x3FF)
    x = (x | (x << np.uint64(16))) & np.uint64(0x030000FF)
    x = (x | (x << np.uint64(8))) & np.uint64(0x0300F00F)
    x = (x | (x << np.uint64(4))) & np.uint64(0x030C30C3)
    x = (x | (x << np.uint64(2))) & np.uint64(0x09249249)
    return x


def morton_order(p):
    lo, hi = p.min(0), p.max(0)
    n = ((p - lo) / np.maximum(hi - lo, 1e-9) * 1023).astype(np.uint64)
    code = _part1by2(n[:, 0]) | (_part1by2(n[:, 1]) << np.uint64(1)) | (_part1by2(n[:, 2]) << np.uint64(2))
    return np.argsort(code, kind="stable")


# writing
CHUNK_PROPS = ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z",
               "min_scale_x", "min_scale_y", "min_scale_z", "max_scale_x", "max_scale_y", "max_scale_z",
               "min_r", "min_g", "min_b", "max_r", "max_g", "max_b",
               "min_time", "max_time", "min_time_scale", "max_time_scale",
               "min_motion_x", "max_motion_x", "min_motion_y", "max_motion_y", "min_motion_z", "max_motion_z"]
VERTEX_PROPS = ["packed_position", "packed_rotation", "packed_scale", "packed_color", "packed_motion", "packed_time"]


def write_cply(path, s, seg_len, fps):
    """s: dict of arrays (already in file-local time and the player's coordinate system)."""
    order = morton_order(s["pos"])
    s = {k: v[order] for k, v in s.items()}
    n = len(s["pos"])
    c = (n + CHUNK - 1) // CHUNK
    pad = c * CHUNK - n

    def chunked(x):
        x = x.reshape(n, -1)
        if pad:
            x = np.concatenate([x, np.repeat(x[-1:], pad, axis=0)], axis=0)
        return x.reshape(c, CHUNK, -1)

    def minmax(x):
        k = chunked(x)
        return k.min(1), k.max(1)

    pmin, pmax = minmax(s["pos"])
    smin, smax = minmax(s["lscale"])
    cmin, cmax = minmax(s["rgb"])
    tmin, tmax = minmax(s["t0"])
    lmin, lmax = minmax(s["lnsig"])
    mmin, mmax = minmax(s["vel"])

    cid = np.arange(n) // CHUNK
    npos = normalize(s["pos"], pmin[cid], pmax[cid])
    nscl = normalize(s["lscale"], smin[cid], smax[cid])
    ncol = normalize(s["rgb"], cmin[cid], cmax[cid])
    nvel = normalize(s["vel"], mmin[cid], mmax[cid])
    nt = normalize(s["t0"][:, None], tmin[cid], tmax[cid])[:, 0]
    nsg = normalize(s["lnsig"][:, None], lmin[cid], lmax[cid])[:, 0]

    verts = np.stack([
        pack_111011(npos[:, 0], npos[:, 1], npos[:, 2]),
        pack_rotation(s["quat"]),
        pack_111011(nscl[:, 0], nscl[:, 1], nscl[:, 2]),
        (unorm(ncol[:, 0], 8) << 24) | (unorm(ncol[:, 1], 8) << 16) | (unorm(ncol[:, 2], 8) << 8) | unorm(s["alpha"], 8),
        pack_111011(nvel[:, 0], nvel[:, 1], nvel[:, 2]),
        (unorm(nsg, 11) << 21) | (unorm(nt, 10) << 11),
    ], axis=1).astype("<u4")

    cols = [pmin[:, 0], pmin[:, 1], pmin[:, 2], pmax[:, 0], pmax[:, 1], pmax[:, 2],
            smin[:, 0], smin[:, 1], smin[:, 2], smax[:, 0], smax[:, 1], smax[:, 2],
            cmin[:, 0], cmin[:, 1], cmin[:, 2], cmax[:, 0], cmax[:, 1], cmax[:, 2],
            tmin[:, 0], tmax[:, 0], lmin[:, 0], lmax[:, 0],
            mmin[:, 0], mmax[:, 0], mmin[:, 1], mmax[:, 1], mmin[:, 2], mmax[:, 2]]
    chunks = np.stack(cols, axis=1).astype("<f4")

    lines = ["ply", "format binary_little_endian 1.0",
             f"comment fourd_seglen {seg_len:.9g}", f"comment fourd_fps {fps:.9g}",
             f"element chunk {c}", *[f"property float {p}" for p in CHUNK_PROPS],
             f"element vertex {n}", *[f"property uint {p}" for p in VERTEX_PROPS], "end_header"]
    header = ("\n".join(lines) + "\n").encode("ascii")
    with open(path, "wb") as f:
        f.write(header)
        f.write(chunks.tobytes())
        f.write(verts.tobytes())
    return s, len(header) + chunks.nbytes + verts.nbytes


# reading it back (verify)
def decode_cply(path):
    """Decode a written file the way Spark does. Used by --verify and --self-test."""
    with open(path, "rb") as f:
        hdr = []
        while True:
            line = f.readline().decode("ascii").strip()
            hdr.append(line)
            if line == "end_header":
                break
        body = f.read()
    cp, vp, nc, nv, cur = [], [], 0, 0, None
    for line in hdr:
        t = line.split()
        if t[0] == "element":
            cur = t[1]
            if cur == "chunk":
                nc = int(t[2])
            else:
                nv = int(t[2])
        elif t[0] == "property":
            (cp if cur == "chunk" else vp).append(t[2])
    ch = np.frombuffer(body, dtype=np.dtype([(p, "<f4") for p in cp]), count=nc)
    v = np.frombuffer(body, dtype=np.dtype([(p, "<u4") for p in vp]), count=nv, offset=nc * 4 * len(cp))
    c = ch[np.arange(nv) >> 8]
    lerp = lambda f, a, b: a + f * (b - a)
    u = {k: v[k].astype(np.uint64) for k in VERTEX_PROPS}
    pp, pr, ps, pc, pm, pt = (u[k] for k in VERTEX_PROPS)
    sq2 = math.sqrt(2.0)
    r0 = (((pr >> 20) & 1023) / 1023 - 0.5) * sq2
    r1 = (((pr >> 10) & 1023) / 1023 - 0.5) * sq2
    r2 = ((pr & 1023) / 1023 - 0.5) * sq2
    rr = np.sqrt(np.maximum(0, 1 - r0 * r0 - r1 * r1 - r2 * r2))
    o = ((pr >> 30) & 3).astype(int)
    quat = np.stack([np.where(o == 0, r0, np.where(o == 1, rr, r1)),
                     np.where(o <= 1, r1, np.where(o == 2, rr, r2)),
                     np.where(o <= 2, r2, rr),
                     np.where(o == 0, rr, r0)], 1)                      # (x, y, z, w)
    return {
        "pos": np.stack([lerp(((pp >> 21) & 2047) / 2047, c["min_x"], c["max_x"]),
                         lerp(((pp >> 11) & 1023) / 1023, c["min_y"], c["max_y"]),
                         lerp((pp & 2047) / 2047, c["min_z"], c["max_z"])], 1),
        "quat": quat,
        "lscale": np.stack([lerp(((ps >> 21) & 2047) / 2047, c["min_scale_x"], c["max_scale_x"]),
                            lerp(((ps >> 11) & 1023) / 1023, c["min_scale_y"], c["max_scale_y"]),
                            lerp((ps & 2047) / 2047, c["min_scale_z"], c["max_scale_z"])], 1),
        "rgb": np.stack([lerp(((pc >> 24) & 255) / 255, c["min_r"], c["max_r"]),
                         lerp(((pc >> 16) & 255) / 255, c["min_g"], c["max_g"]),
                         lerp(((pc >> 8) & 255) / 255, c["min_b"], c["max_b"])], 1),
        "alpha": (pc & 255) / 255,
        "vel": np.stack([lerp(((pm >> 21) & 2047) / 2047, c["min_motion_x"], c["max_motion_x"]),
                         lerp(((pm >> 11) & 1023) / 1023, c["min_motion_y"], c["max_motion_y"]),
                         lerp((pm & 2047) / 2047, c["min_motion_z"], c["max_motion_z"])], 1),
        "lnsig": lerp((pt >> 21) / 2047, c["min_time_scale"], c["max_time_scale"]),
        "t0": lerp(((pt >> 11) & 1023) / 1023, c["min_time"], c["max_time"]),
    }


def verify(path, expected):
    """Compare a written file with the arrays that were packed into it. Returns the worst problems."""
    d = decode_cply(path)
    dot = np.abs(np.sum(d["quat"] * expected["quat"] / np.linalg.norm(expected["quat"], axis=1, keepdims=True), axis=1))
    rot_deg = np.degrees(2 * np.arccos(np.clip(dot, 0, 1)))
    report = {
        "position (max error)": np.abs(d["pos"] - expected["pos"]).max(),
        "log scale (max error)": np.abs(d["lscale"] - expected["lscale"]).max(),
        "color (max error)": np.abs(d["rgb"] - expected["rgb"]).max(),
        "opacity (max error)": np.abs(d["alpha"] - expected["alpha"]).max(),
        "velocity (max error)": np.abs(d["vel"] - expected["vel"]).max(),
        "time center (max error)": np.abs(d["t0"] - expected["t0"]).max(),
        "log sigma (max error)": np.abs(d["lnsig"] - expected["lnsig"]).max(),
        "rotation (median / 99th pct, degrees)": (float(np.median(rot_deg)), float(np.percentile(rot_deg, 99))),
    }
    ok = np.median(rot_deg) < 1.0 and report["opacity (max error)"] < 0.01
    return ok, report


# converting
def convert(args):
    a, meta = read_ftgs_ply(args.input)
    print(f"{len(a)} Gaussians read; header: {meta}")

    pos = np.stack([a["x"], a["y"], a["z"]], 1).astype(np.float64)
    if "velocity_0" in a.dtype.names and meta.get("use_velocity", "1") != "0":
        vel = np.stack([a["velocity_0"], a["velocity_1"], a["velocity_2"]], 1).astype(np.float64)
    else:
        vel = np.zeros_like(pos)
    tau = a["time"].astype(np.float64)                     # normalized time, 0..1 is the clip
    ldur = a["log_duration"].astype(np.float64)
    q = np.stack([a["rot_1"], a["rot_2"], a["rot_3"], a["rot_0"]], 1).astype(np.float64)   # wxyz -> xyzw
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    lscale = np.stack([a["scale_0"], a["scale_1"], a["scale_2"]], 1).astype(np.float64)
    alpha = 1.0 / (1.0 + np.exp(-a["opacity"].astype(np.float64)))
    rgb = np.clip(0.5 + SH_C0 * np.stack([a["f_dc_0"], a["f_dc_1"], a["f_dc_2"]], 1).astype(np.float64), 0, 1)

    # Duration of the whole clip in seconds: frame 0 .. n_frames-1 maps to normalized time 0..1.
    if args.duration:
        total = args.duration
    else:
        frames = args.frames or (int(float(meta["n_frames"])) if "n_frames" in meta else 0)
        if not frames:
            sys.exit("The clip length is unknown: pass --frames N (or --duration SECONDS).")
        total = max(frames - 1, 1) / args.fps
    print(f"clip duration: {total:.4g} s")

    # Spatial transform: trainer space -> the player's space (Y up, meters).
    qr = quat_mul(quat_axis(2, args.rot_z), quat_mul(quat_axis(1, args.rot_y), quat_axis(0, args.rot_x)))
    if args.zup:
        qr = quat_mul(quat_axis(0, -90.0), qr)             # Z up (Blender/COLMAP) -> Y up
    rm = quat_to_mat(qr)
    pos = pos @ rm.T
    vel = vel @ rm.T
    q = quat_mul(np.broadcast_to(qr, q.shape), q)
    scale = args.scale
    if args.fit_height:
        y1, y99 = np.percentile(pos[:, 1], [1, 99])
        scale = args.fit_height / max(y99 - y1, 1e-9)
    pos *= scale
    vel *= scale
    lscale = np.clip(lscale + math.log(scale), -20.0, 20.0)
    if args.ground:
        x1, x99 = np.percentile(pos[:, 0], [1, 99])
        z1, z99 = np.percentile(pos[:, 2], [1, 99])
        pos -= np.array([(x1 + x99) / 2, np.percentile(pos[:, 1], 1), (z1 + z99) / 2])
    pos += np.array([args.tx, args.ty, args.tz])
    print(f"scale {scale:.5g}; bounding box {pos.min(0).round(3)} .. {pos.max(0).round(3)}")

    # Seconds: velocity per second, time center in seconds, ln(sigma) in seconds.
    t0_all = tau * total
    vel = vel / total
    lnsig_all = ldur + math.log(total)
    sigma_all = np.exp(lnsig_all)

    window = args.chunk_seconds if args.chunk_seconds > 0 else total
    n_files = max(1, int(math.ceil(total / window - 1e-9)))
    if n_files > 1:
        os.makedirs(args.output, exist_ok=True)
    elif os.path.isdir(args.output):
        sys.exit("Output is a directory; give a file name (or use --chunk-seconds).")

    written = 0
    for k in range(n_files):
        w0, w1 = k * window, (k + 1) * window
        # strongest temporal opacity a splat reaches inside this window
        t_near = np.clip(t0_all, w0, w1)
        peak = alpha * np.exp(-0.5 * ((t_near - t0_all) / sigma_all) ** 2)
        keep = peak >= args.min_opacity
        if args.max_splats and keep.sum() > args.max_splats:
            importance = np.where(keep, peak * np.exp(lscale.mean(1)), -1.0)
            keep &= importance >= np.sort(importance)[-args.max_splats]
        if not keep.any():
            print(f"window {k}: no visible splats, skipped")
            continue
        s = {"pos": pos[keep], "vel": vel[keep], "t0": t0_all[keep] - w0, "lnsig": lnsig_all[keep],
             "quat": q[keep], "lscale": lscale[keep], "alpha": alpha[keep], "rgb": rgb[keep]}
        out = os.path.join(args.output, f"{k:02d}.c.ply") if n_files > 1 else args.output
        s, size = write_cply(out, s, window, args.fps)
        written += size
        print(f"{out}: window {w0:.4g}..{w1:.4g} s, {len(s['pos'])} splats, {size / 1e6:.1f} MB")
        if args.verify:
            ok, rep = verify(out, s)
            print("  verify:", "OK" if ok else "PROBLEM", {k2: (v if isinstance(v, tuple) else round(float(v), 5)) for k2, v in rep.items()})
    print(f"done: {n_files} file(s), {written / 1e6:.1f} MB in total.")
    if n_files > 1 or window != 5.0:
        print(f"In the player use ?seglen={window:.9g} (the files also carry it in their header).")


# self test
def self_test():
    """Write a synthetic .ftgs.ply, convert it, and check against an independent computation."""
    rng = np.random.default_rng(7)
    n, frames, fps = 3000, 61, 30.0
    names = (["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity"]
             + ["scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "time", "log_duration",
                "velocity_0", "velocity_1", "velocity_2"])
    arr = np.zeros(n, dtype=np.dtype([(p, "<f4") for p in names]))
    arr["x"], arr["y"], arr["z"] = rng.uniform(-1, 1, (3, n))
    arr["f_dc_0"], arr["f_dc_1"], arr["f_dc_2"] = rng.uniform(-1, 1, (3, n))
    arr["opacity"] = rng.uniform(-1, 3, n)
    for i in range(3):
        arr[f"scale_{i}"] = rng.uniform(-5, -3, n)
    qq = rng.normal(size=(n, 4))
    qq /= np.linalg.norm(qq, axis=1, keepdims=True)
    for i in range(4):
        arr[f"rot_{i}"] = qq[:, i]
    arr["time"] = rng.uniform(-0.1, 1.1, n)
    arr["log_duration"] = rng.uniform(math.log(0.05), math.log(0.5), n)
    for i in range(3):
        arr[f"velocity_{i}"] = rng.uniform(-0.3, 0.3, n)
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "t.ftgs.ply")
        header = ("ply\nformat binary_little_endian 1.0\ncomment ftgs_version 1\ncomment time_units normalized\n"
                  f"comment use_velocity 1\ncomment n_frames {frames}\nelement vertex {n}\n"
                  + "".join(f"property float {p}\n" for p in names) + "end_header\n")
        with open(src, "wb") as f:
            f.write(header.encode("ascii"))
            f.write(arr.tobytes())
        out = os.path.join(tmp, "clip")
        ns = argparse.Namespace(input=src, output=out, fps=fps, frames=0, duration=0.0, chunk_seconds=0.5,
                                zup=False, rot_x=0.0, rot_y=0.0, rot_z=0.0, scale=1.0, fit_height=0.0, ground=False,
                                tx=0.0, ty=0.0, tz=0.0, min_opacity=0.01, max_splats=0, verify=True)
        convert(ns)
        total = (frames - 1) / fps
        # independent check: where is every splat at a few global times, from the source vs from the files?
        src_pos = np.stack([arr["x"], arr["y"], arr["z"]], 1).astype(np.float64)
        src_vel = np.stack([arr[f"velocity_{i}"] for i in range(3)], 1).astype(np.float64) / total
        src_t0 = arr["time"].astype(np.float64) * total
        worst = 0.0
        checked = 0
        for k in range(int(math.ceil(total / 0.5 - 1e-9))):
            f = os.path.join(out, f"{k:02d}.c.ply")
            if not os.path.exists(f):
                continue
            d = decode_cply(f)
            for tl in (0.1, 0.25, 0.4):                    # local times in this file
                tg = k * 0.5 + tl
                at_dec = d["pos"] + d["vel"] * (tl - d["t0"])[:, None]
                for j in range(0, len(at_dec), 37):          # match by nearest source splat at time tg
                    tgt = src_pos + src_vel * (tg - src_t0)[:, None]
                    i = int(np.argmin(np.linalg.norm(tgt - at_dec[j], axis=1)))
                    worst = max(worst, float(np.linalg.norm(tgt[i] - at_dec[j])))
                    checked += 1
        print(f"\nself-test: {checked} splat positions compared at global times, worst distance {worst:.5f}")
        if worst > 0.02:
            sys.exit("self-test FAILED")
        print("self-test OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="a .ftgs.ply file")
    ap.add_argument("output", nargs="?", help="output .c.ply file, or a directory when --chunk-seconds is used")
    ap.add_argument("--fps", type=float, default=30.0, help="frame rate of the source video (default 30)")
    ap.add_argument("--frames", type=int, default=0, help="number of frames if the file header does not say")
    ap.add_argument("--duration", type=float, default=0.0, help="clip length in seconds (overrides frames/fps)")
    ap.add_argument("--chunk-seconds", type=float, default=0.0,
                    help="split into files that each cover this many seconds (e.g. 5); 0 = one file")
    ap.add_argument("--zup", action="store_true", help="source space is Z up (Blender/COLMAP): rotate to Y up")
    ap.add_argument("--rot-x", type=float, default=0.0, help="extra rotation about x, degrees")
    ap.add_argument("--rot-y", type=float, default=0.0, help="extra rotation about y, degrees")
    ap.add_argument("--rot-z", type=float, default=0.0, help="extra rotation about z, degrees")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--fit-height", type=float, default=0.0, help="scale so the content is this tall (meters)")
    ap.add_argument("--ground", action="store_true", help="center on x/z and put the bottom at y = 0")
    ap.add_argument("--tx", type=float, default=0.0)
    ap.add_argument("--ty", type=float, default=0.0)
    ap.add_argument("--tz", type=float, default=0.0)
    ap.add_argument("--min-opacity", type=float, default=0.005,
                    help="drop splats that never reach this opacity in a file's window (0.02-0.05 gives smaller files)")
    ap.add_argument("--max-splats", type=int, default=0, help="keep at most N splats per file (0 = all)")
    ap.add_argument("--verify", action="store_true", help="decode every written file and compare it with the input")
    ap.add_argument("--self-test", action="store_true", help="run a built-in check and exit")
    opts = ap.parse_args()
    if opts.self_test:
        self_test()
    elif not opts.input or not opts.output:
        ap.error("input and output are required (or use --self-test)")
    else:
        convert(opts)