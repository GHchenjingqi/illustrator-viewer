//! AI Viewer Engine 自研 WebAssembly 加速模块。
//!
//! 只负责数值/字节热点：
//! - 批量路径坐标的仿射变换与包围盒
//! - 二进制模式计数（标记扫描）
//!
//! 不包含任何 Illustrator 解析语义；JS 解析器始终保留独立运行路径。

use std::alloc::{alloc, dealloc, Layout};
use std::collections::VecDeque;

const ALIGN: usize = 8;
const MAX_SCAN_PATTERNS: usize = 64;

/// 分配 WASM 线性内存，供 JS 写入数据。
#[no_mangle]
pub extern "C" fn alloc_bytes(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let layout = match Layout::from_size_align(size, ALIGN) {
        Ok(layout) => layout,
        Err(_) => return std::ptr::null_mut(),
    };
    unsafe { alloc(layout) }
}

/// 释放 `alloc_bytes` 分配的内存。
#[no_mangle]
pub extern "C" fn dealloc_bytes(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(size, ALIGN) {
        unsafe { dealloc(ptr, layout) };
    }
}

/// 计算一批点（x, y 交错）在六元组仿射矩阵下的包围盒。
///
/// out: [min_x, min_y, max_x, max_y]
/// 返回 1 表示成功，0 表示输入无效。
#[no_mangle]
pub extern "C" fn compute_bounds(
    points: *const f64,
    point_values: usize,
    matrix: *const f64,
    out: *mut f64,
) -> u32 {
    if points.is_null() || matrix.is_null() || out.is_null() || point_values < 2 {
        return 0;
    }

    unsafe {
        let values = std::slice::from_raw_parts(points, point_values);
        let m = std::slice::from_raw_parts(matrix, 6);
        let (a, b, c, d, e, f) = (m[0], m[1], m[2], m[3], m[4], m[5]);

        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;

        for pair in values.chunks_exact(2) {
            let x = pair[0];
            let y = pair[1];
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            let tx = a * x + c * y + e;
            let ty = b * x + d * y + f;
            if !tx.is_finite() || !ty.is_finite() {
                continue;
            }
            if tx < min_x {
                min_x = tx;
            }
            if ty < min_y {
                min_y = ty;
            }
            if tx > max_x {
                max_x = tx;
            }
            if ty > max_y {
                max_y = ty;
            }
        }

        if !min_x.is_finite() || !min_y.is_finite() || !max_x.is_finite() || !max_y.is_finite() {
            return 0;
        }

        let output = std::slice::from_raw_parts_mut(out, 4);
        output[0] = min_x;
        output[1] = min_y;
        output[2] = max_x;
        output[3] = max_y;
        1
    }
}

/// 统计字节模式出现次数（不重叠）。
#[no_mangle]
pub extern "C" fn count_pattern(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> u32 {
    if haystack.is_null() || needle.is_null() || needle_len == 0 || haystack_len < needle_len {
        return 0;
    }

    unsafe {
        let data = std::slice::from_raw_parts(haystack, haystack_len);
        let pattern = std::slice::from_raw_parts(needle, needle_len);
        let mut count: u32 = 0;
        let mut index = 0usize;
        while index + needle_len <= data.len() {
            if &data[index..index + needle_len] == pattern {
                count = count.saturating_add(1);
                index += needle_len;
            } else {
                index += 1;
            }
        }
        count
    }
}

/// 批量仿射变换：输入/输出均为 x,y 交错 f64。
#[no_mangle]
pub extern "C" fn transform_points(
    points: *const f64,
    point_values: usize,
    matrix: *const f64,
    out: *mut f64,
) -> u32 {
    if points.is_null() || matrix.is_null() || out.is_null() || point_values < 2 {
        return 0;
    }
    unsafe {
        let input = std::slice::from_raw_parts(points, point_values);
        let m = std::slice::from_raw_parts(matrix, 6);
        let output = std::slice::from_raw_parts_mut(out, point_values);
        let (a, b, c, d, e, f) = (m[0], m[1], m[2], m[3], m[4], m[5]);
        for index in (0..point_values).step_by(2) {
            let x = input[index];
            let y = input[index + 1];
            output[index] = a * x + c * y + e;
            output[index + 1] = b * x + d * y + f;
        }
        1
    }
}

/// 多模式字节扫描（Aho-Corasick），一次遍历统计所有模式。
///
/// patterns_blob 格式：
///   u32 pattern_count
///   循环：u32 pattern_len + pattern bytes
/// out_counts: u32[pattern_count]
/// out_first:  i32[pattern_count]（首次出现偏移，-1 表示未出现）
#[no_mangle]
pub extern "C" fn scan_patterns(
    haystack: *const u8,
    haystack_len: usize,
    patterns_blob: *const u8,
    blob_len: usize,
    out_counts: *mut u32,
    out_first: *mut i32,
    max_patterns: usize,
) -> u32 {
    if haystack.is_null()
        || patterns_blob.is_null()
        || out_counts.is_null()
        || out_first.is_null()
        || blob_len < 4
        || max_patterns == 0
        || max_patterns > MAX_SCAN_PATTERNS
    {
        return 0;
    }

    let blob = unsafe { std::slice::from_raw_parts(patterns_blob, blob_len) };
    let pattern_count = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    if pattern_count == 0 || pattern_count > max_patterns {
        return 0;
    }

    let mut offset = 4usize;
    let mut patterns: Vec<&[u8]> = Vec::with_capacity(pattern_count);
    for _ in 0..pattern_count {
        if offset + 4 > blob.len() {
            return 0;
        }
        let length = u32::from_le_bytes([
            blob[offset],
            blob[offset + 1],
            blob[offset + 2],
            blob[offset + 3],
        ]) as usize;
        offset += 4;
        if length == 0 || offset + length > blob.len() {
            return 0;
        }
        patterns.push(&blob[offset..offset + length]);
        offset += length;
    }

    // 构建 trie
    let mut next: Vec<[i32; 256]> = vec![[-1; 256]];
    let mut fail: Vec<usize> = vec![0];
    let mut out: Vec<Vec<u32>> = vec![Vec::new()];

    for (pattern_id, pattern) in patterns.iter().enumerate() {
        let mut state = 0usize;
        for &byte in pattern.iter() {
            let slot = byte as usize;
            let candidate = next[state][slot];
            if candidate == -1 {
                next.push([-1; 256]);
                fail.push(0);
                out.push(Vec::new());
                let new_state = next.len() - 1;
                next[state][slot] = new_state as i32;
                state = new_state;
            } else {
                state = candidate as usize;
            }
        }
        out[state].push(pattern_id as u32);
    }

    // 构建 fail 指针
    let mut queue: VecDeque<usize> = VecDeque::new();
    for slot in 0..256 {
        let candidate = next[0][slot];
        if candidate != -1 {
            fail[candidate as usize] = 0;
            queue.push_back(candidate as usize);
        }
    }
    while let Some(state) = queue.pop_front() {
        for slot in 0..256 {
            let candidate = next[state][slot];
            if candidate == -1 {
                continue;
            }
            let mut fallback = fail[state];
            while fallback != 0 && next[fallback][slot] == -1 {
                fallback = fail[fallback];
            }
            if next[fallback][slot] != -1 && next[fallback][slot] != candidate {
                fail[candidate as usize] = next[fallback][slot] as usize;
            }
            queue.push_back(candidate as usize);
        }
    }

    let data = unsafe { std::slice::from_raw_parts(haystack, haystack_len) };
    let counts = unsafe { std::slice::from_raw_parts_mut(out_counts, pattern_count) };
    let firsts = unsafe { std::slice::from_raw_parts_mut(out_first, pattern_count) };
    counts.fill(0);
    for value in firsts.iter_mut() {
        *value = -1;
    }

    let mut state = 0usize;
    for (index, &byte) in data.iter().enumerate() {
        let slot = byte as usize;
        while state != 0 && next[state][slot] == -1 {
            state = fail[state];
        }
        if next[state][slot] != -1 {
            state = next[state][slot] as usize;
        } else {
            state = 0;
        }

        let mut output_state = state;
        loop {
            for &pattern_id in &out[output_state] {
                let id = pattern_id as usize;
                if id < pattern_count {
                    counts[id] = counts[id].saturating_add(1);
                    if firsts[id] < 0 {
                        let length = patterns[id].len();
                        if length > 0 && index + 1 >= length {
                            firsts[id] = (index + 1 - length) as i32;
                        }
                    }
                }
            }
            if output_state == 0 {
                break;
            }
            output_state = fail[output_state];
        }
    }

    1
}

#[no_mangle]
pub extern "C" fn wasm_version() -> u32 {
    1
}
