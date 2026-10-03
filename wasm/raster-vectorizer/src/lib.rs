use std::sync::atomic::{AtomicU32, Ordering};

const MAX_PIXELS: usize = 1_048_576;
const MAX_COLORS: usize = 16;
const MAX_CONTOURS_PER_COLOR: usize = 10_000;
const MAX_POINTS_PER_COLOR: usize = 20_000;
const MAX_TOTAL_POINTS: usize = 60_000;
const TRANSPARENT_ALPHA: u8 = 32;
const ERROR_NONE: u32 = 0;
const ERROR_INPUT: u32 = 1;
const ERROR_DIMENSIONS: u32 = 2;
const ERROR_COMPLEXITY: u32 = 3;

static LAST_RESULT_LENGTH: AtomicU32 = AtomicU32::new(0);
static LAST_ERROR: AtomicU32 = AtomicU32::new(ERROR_NONE);

#[derive(Clone, Copy, Default)]
struct HistogramBin {
    count: u32,
    sums: [u64; 4],
}

#[derive(Clone, Copy)]
struct Color {
    count: u32,
    sums: [u64; 4],
    average: [u8; 4],
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Point {
    x: u16,
    y: u16,
}

fn set_error(error: u32) {
    LAST_ERROR.store(error, Ordering::SeqCst);
}

fn luminance(r: u8, g: u8, b: u8) -> u8 {
    ((u32::from(r) * 54 + u32::from(g) * 183 + u32::from(b) * 19) >> 8) as u8
}

fn color_histogram(rgba: &[u8]) -> Vec<Color> {
    let mut histogram = vec![HistogramBin::default(); 32_768];
    for pixel in rgba.chunks_exact(4) {
        if pixel[3] < TRANSPARENT_ALPHA {
            continue;
        }
        let key = (usize::from(pixel[0] >> 3) << 10)
            | (usize::from(pixel[1] >> 3) << 5)
            | usize::from(pixel[2] >> 3);
        let bin = &mut histogram[key];
        bin.count += 1;
        for channel in 0..4 {
            bin.sums[channel] += u64::from(pixel[channel]);
        }
    }
    histogram
        .into_iter()
        .filter(|bin| bin.count > 0)
        .map(|bin| Color {
            count: bin.count,
            sums: bin.sums,
            average: std::array::from_fn(|channel| {
                ((bin.sums[channel] + u64::from(bin.count) / 2) / u64::from(bin.count)) as u8
            }),
        })
        .collect()
}

fn box_range(colors: &[Color], indices: &[usize]) -> ([u8; 3], [u8; 3]) {
    let mut minimum = [u8::MAX; 3];
    let mut maximum = [u8::MIN; 3];
    for &index in indices {
        for channel in 0..3 {
            minimum[channel] = minimum[channel].min(colors[index].average[channel]);
            maximum[channel] = maximum[channel].max(colors[index].average[channel]);
        }
    }
    (minimum, maximum)
}

fn median_cut_palette(colors: &[Color], maximum_colors: usize) -> Vec<[u8; 4]> {
    if colors.is_empty() {
        return Vec::new();
    }
    if colors.len() <= maximum_colors {
        let mut direct: Vec<[u8; 4]> = colors.iter().map(|color| color.average).collect();
        direct.sort_by_key(|color| (luminance(color[0], color[1], color[2]), color[0], color[1], color[2]));
        return direct;
    }

    let mut boxes = vec![(0..colors.len()).collect::<Vec<_>>()];
    while boxes.len() < maximum_colors {
        let mut split_index = None;
        let mut split_score = 0u64;
        let mut split_channel = 0usize;
        for (box_index, indices) in boxes.iter().enumerate() {
            if indices.len() < 2 {
                continue;
            }
            let (minimum, maximum) = box_range(colors, indices);
            let (channel, range) = (0..3)
                .map(|channel| (channel, maximum[channel] - minimum[channel]))
                .max_by_key(|(_, range)| *range)
                .unwrap_or((0, 0));
            let count = indices.iter().map(|index| u64::from(colors[*index].count)).sum::<u64>();
            let score = u64::from(range) * count;
            if score > split_score {
                split_score = score;
                split_index = Some(box_index);
                split_channel = channel;
            }
        }
        let Some(box_index) = split_index else { break };
        let mut indices = boxes.remove(box_index);
        indices.sort_by_key(|index| (colors[*index].average[split_channel], *index));
        let total = indices.iter().map(|index| u64::from(colors[*index].count)).sum::<u64>();
        let mut cumulative = 0u64;
        let mut boundary = 1usize;
        for (index, color_index) in indices.iter().enumerate().take(indices.len() - 1) {
            cumulative += u64::from(colors[*color_index].count);
            boundary = index + 1;
            if cumulative * 2 >= total {
                break;
            }
        }
        let right = indices.split_off(boundary);
        boxes.insert(box_index, indices);
        boxes.insert(box_index + 1, right);
    }

    let mut palette: Vec<[u8; 4]> = boxes
        .iter()
        .map(|indices| {
            let mut sums = [0u64; 4];
            let mut count = 0u64;
            for &index in indices {
                let color = colors[index];
                count += u64::from(color.count);
                for channel in 0..4 {
                    sums[channel] += color.sums[channel];
                }
            }
            std::array::from_fn(|channel| ((sums[channel] + count / 2) / count) as u8)
        })
        .collect();
    palette.sort_by_key(|color| (luminance(color[0], color[1], color[2]), color[0], color[1], color[2]));
    palette
}

fn build_palette(rgba: &[u8], mode: u32, maximum_colors: usize) -> Vec<[u8; 4]> {
    match mode {
        0 => median_cut_palette(&color_histogram(rgba), maximum_colors),
        1 => (0..maximum_colors)
            .map(|index| {
                let gray = ((index * 255 + (maximum_colors - 1) / 2) / (maximum_colors - 1)) as u8;
                [gray, gray, gray, 255]
            })
            .collect(),
        2 => vec![[0, 0, 0, 255], [255, 255, 255, 255]],
        _ => Vec::new(),
    }
}

fn nearest_color(pixel: &[u8], palette: &[[u8; 4]]) -> u8 {
    let mut nearest = 0usize;
    let mut best_distance = u64::MAX;
    for (index, color) in palette.iter().enumerate() {
        let red = i64::from(pixel[0]) - i64::from(color[0]);
        let green = i64::from(pixel[1]) - i64::from(color[1]);
        let blue = i64::from(pixel[2]) - i64::from(color[2]);
        let distance = (red * red * 3 + green * green * 6 + blue * blue) as u64;
        if distance < best_distance {
            best_distance = distance;
            nearest = index;
        }
    }
    nearest as u8
}

fn classify(rgba: &[u8], palette: &[[u8; 4]], mode: u32, threshold: u8) -> Vec<u8> {
    let mut labels = Vec::with_capacity(rgba.len() / 4);
    for pixel in rgba.chunks_exact(4) {
        if pixel[3] < TRANSPARENT_ALPHA {
            labels.push(u8::MAX);
            continue;
        }
        let label = match mode {
            2 => u8::from(luminance(pixel[0], pixel[1], pixel[2]) >= threshold),
            1 => {
                let gray = usize::from(luminance(pixel[0], pixel[1], pixel[2]));
                let count = palette.len();
                ((gray * (count - 1) + 127) / 255) as u8
            }
            _ => nearest_color(pixel, palette),
        };
        labels.push(label);
    }
    labels
}

fn edge_start(x: usize, y: usize, side: usize) -> (usize, usize, usize) {
    match side {
        0 => (x, y, 0),
        1 => (x + 1, y, 1),
        2 => (x + 1, y + 1, 2),
        _ => (x, y + 1, 3),
    }
}

fn edge_end(x: usize, y: usize, side: usize) -> (usize, usize, usize) {
    match side {
        0 => (x + 1, y, 0),
        1 => (x + 1, y + 1, 1),
        2 => (x, y + 1, 2),
        _ => (x, y, 3),
    }
}

fn outgoing_edge(width: usize, height: usize, vx: usize, vy: usize, direction: usize) -> Option<(usize, usize, usize)> {
    let candidate = match direction {
        0 if vx < width && vy < height => (vx, vy, 0),
        1 if vx > 0 && vx <= width && vy < height => (vx - 1, vy, 1),
        2 if vx > 0 && vx <= width && vy > 0 && vy <= height => (vx - 1, vy - 1, 2),
        3 if vx < width && vy > 0 && vy <= height => (vx, vy - 1, 3),
        _ => return None,
    };
    Some(candidate)
}

fn point_distance_to_segment_squared(point: Point, start: Point, end: Point) -> f64 {
    let px = f64::from(point.x);
    let py = f64::from(point.y);
    let ax = f64::from(start.x);
    let ay = f64::from(start.y);
    let dx = f64::from(end.x) - ax;
    let dy = f64::from(end.y) - ay;
    let length = dx * dx + dy * dy;
    if length == 0.0 {
        return (px - ax) * (px - ax) + (py - ay) * (py - ay);
    }
    let projection = (((px - ax) * dx + (py - ay) * dy) / length).clamp(0.0, 1.0);
    let nearest_x = ax + projection * dx;
    let nearest_y = ay + projection * dy;
    (px - nearest_x) * (px - nearest_x) + (py - nearest_y) * (py - nearest_y)
}

fn simplify_open(points: &[Point], tolerance_squared: f64) -> Vec<Point> {
    if points.len() <= 2 || tolerance_squared <= 0.0 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0usize, points.len() - 1)];
    while let Some((start, end)) = stack.pop() {
        let mut farthest = None;
        let mut maximum = tolerance_squared;
        for index in start + 1..end {
            let distance = point_distance_to_segment_squared(points[index], points[start], points[end]);
            if distance > maximum {
                maximum = distance;
                farthest = Some(index);
            }
        }
        if let Some(index) = farthest {
            keep[index] = true;
            stack.push((start, index));
            stack.push((index, end));
        }
    }
    points.iter().zip(keep).filter_map(|(point, keep)| keep.then_some(*point)).collect()
}

fn simplify_closed(points: &[Point], tolerance_squared: f64) -> Vec<Point> {
    if points.len() <= 4 {
        return points.to_vec();
    }
    let origin = points[0];
    let farthest = (1..points.len())
        .max_by(|left, right| {
            let left_point = points[*left];
            let right_point = points[*right];
            let left_distance = i64::from(left_point.x) - i64::from(origin.x);
            let left_dy = i64::from(left_point.y) - i64::from(origin.y);
            let right_distance = i64::from(right_point.x) - i64::from(origin.x);
            let right_dy = i64::from(right_point.y) - i64::from(origin.y);
            (left_distance * left_distance + left_dy * left_dy).cmp(&(right_distance * right_distance + right_dy * right_dy))
        })
        .unwrap_or(1);
    let mut first_arc = simplify_open(&points[..=farthest], tolerance_squared);
    let mut second_arc = points[farthest..].to_vec();
    second_arc.push(points[0]);
    second_arc = simplify_open(&second_arc, tolerance_squared);
    if !second_arc.is_empty() {
        first_arc.extend(second_arc.into_iter().skip(1).take_while(|point| *point != points[0]));
    }
    if first_arc.len() >= 3 { first_arc } else { points.to_vec() }
}

fn simplify_collinear(points: Vec<Point>) -> Vec<Point> {
    if points.len() <= 3 {
        return points;
    }
    let mut result: Vec<Point> = Vec::with_capacity(points.len());
    for point in points {
        while result.len() >= 2 {
            let first = result[result.len() - 2];
            let middle = result[result.len() - 1];
            let cross = (i32::from(middle.x) - i32::from(first.x)) * (i32::from(point.y) - i32::from(middle.y))
                - (i32::from(middle.y) - i32::from(first.y)) * (i32::from(point.x) - i32::from(middle.x));
            if cross == 0 {
                result.pop();
            } else {
                break;
            }
        }
        result.push(point);
    }
    loop {
        if result.len() <= 3 {
            break;
        }
        let count = result.len();
        let cross = |first: Point, middle: Point, last: Point| {
            (i32::from(middle.x) - i32::from(first.x)) * (i32::from(last.y) - i32::from(middle.y))
                - (i32::from(middle.y) - i32::from(first.y)) * (i32::from(last.x) - i32::from(middle.x))
        };
        if cross(result[count - 2], result[count - 1], result[0]) == 0 {
            result.pop();
        } else if cross(result[count - 1], result[0], result[1]) == 0 {
            result.remove(0);
        } else {
            break;
        }
    }
    result
}

fn trace_contour(
    edges: &mut [u8],
    width: usize,
    height: usize,
    start: (usize, usize, usize),
    tolerance_squared: f64,
) -> Option<Vec<Point>> {
    let mut current = start;
    let mut points = Vec::new();
    let maximum_steps = width.saturating_mul(height).saturating_mul(4).min(MAX_PIXELS * 4);
    for _ in 0..maximum_steps {
        let (x, y, side) = current;
        let index = y * width + x;
        let bit = 1u8 << side;
        if edges[index] & bit == 0 {
            return None;
        }
        edges[index] &= !bit;
        let (start_x, start_y, direction) = edge_start(x, y, side);
        let (end_x, end_y, _) = edge_end(x, y, side);
        let point = Point { x: start_x as u16, y: start_y as u16 };
        if points.last().is_none_or(|previous: &Point| previous.x != point.x || previous.y != point.y) {
            points.push(point);
        }

        // Keeping the filled pixels on the right and preferring a right turn
        // keeps diagonal pixel islands as independent closed contours.
        let mut next = None;
        for turn in [1usize, 0, 3, 2] {
            let next_direction = (direction + turn) % 4;
            let Some(candidate) = outgoing_edge(width, height, end_x, end_y, next_direction) else { continue };
            if candidate == start {
                next = Some(candidate);
                break;
            }
            let candidate_index = candidate.1 * width + candidate.0;
            if edges[candidate_index] & (1u8 << candidate.2) != 0 {
                next = Some(candidate);
                break;
            }
        }
        let Some(next_edge) = next else { return None };
        if next_edge == start {
            break;
        }
        current = next_edge;
    }
    if points.len() < 3 { return None; }
    let reduced = simplify_closed(&simplify_collinear(points), tolerance_squared);
    (reduced.len() >= 3).then_some(reduced)
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn patch_u16(output: &mut [u8], offset: usize, value: u16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn patch_u32(output: &mut [u8], offset: usize, value: u32) {
    output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn vectorize_rgba(
    rgba: &[u8],
    width: usize,
    height: usize,
    mode: u32,
    maximum_colors: usize,
    threshold: u8,
    tolerance_milli_pixels: u32,
) -> Result<Vec<u8>, u32> {
    let Some(pixel_count) = width.checked_mul(height) else { return Err(ERROR_DIMENSIONS) };
    if width == 0 || height == 0 || width > 4096 || height > 4096 || pixel_count > MAX_PIXELS
        || rgba.len() != pixel_count.saturating_mul(4) || width > u16::MAX as usize || height > u16::MAX as usize {
        return Err(ERROR_DIMENSIONS);
    }
    if mode > 2 || maximum_colors < 2 || maximum_colors > MAX_COLORS || tolerance_milli_pixels > 4000 {
        return Err(ERROR_INPUT);
    }
    let palette = build_palette(rgba, mode, if mode == 2 { 2 } else { maximum_colors });
    if palette.is_empty() {
        return Ok(vec![0, 0, 0, 0]);
    }
    let labels = classify(rgba, &palette, mode, threshold);
    let tolerance = f64::from(tolerance_milli_pixels) / 1000.0;
    let tolerance_squared = tolerance * tolerance;
    let mut output = vec![0, 0, 0, 0];
    let mut output_layers = 0u32;
    let mut total_points = 0usize;

    for (color_index, color) in palette.iter().enumerate() {
        let color_index = color_index as u8;
        let mut edges = vec![0u8; pixel_count];
        let mut boundary_count = 0usize;
        for y in 0..height {
            for x in 0..width {
                let index = y * width + x;
                if labels[index] != color_index {
                    continue;
                }
                let mut mask = 0u8;
                if y == 0 || labels[index - width] != color_index { mask |= 1; }
                if x + 1 == width || labels[index + 1] != color_index { mask |= 2; }
                if y + 1 == height || labels[index + width] != color_index { mask |= 4; }
                if x == 0 || labels[index - 1] != color_index { mask |= 8; }
                edges[index] = mask;
                boundary_count += mask.count_ones() as usize;
            }
        }
        if boundary_count == 0 {
            continue;
        }
        let mut contours = Vec::new();
        let mut color_points = 0usize;
        for y in 0..height {
            for x in 0..width {
                let index = y * width + x;
                for side in 0..4 {
                    if edges[index] & (1u8 << side) == 0 {
                        continue;
                    }
                    let Some(contour) = trace_contour(&mut edges, width, height, (x, y, side), tolerance_squared) else { continue };
                    if contour.len() < 3 {
                        continue;
                    }
                    color_points += contour.len();
                    if color_points > MAX_POINTS_PER_COLOR || contours.len() >= MAX_CONTOURS_PER_COLOR {
                        return Err(ERROR_COMPLEXITY);
                    }
                    contours.push(contour);
                }
            }
        }
        if contours.is_empty() {
            continue;
        }
        output_layers += 1;
        output.extend_from_slice(color);
        let contour_count_offset = output.len();
        let contour_count = contours.len() as u16;
        write_u16(&mut output, contour_count);
        for contour in contours {
            write_u32(&mut output, contour.len() as u32);
            for point in contour {
                write_u16(&mut output, point.x);
                write_u16(&mut output, point.y);
            }
        }
        patch_u16(&mut output, contour_count_offset, contour_count);
        total_points += color_points;
        if total_points > MAX_TOTAL_POINTS {
            return Err(ERROR_COMPLEXITY);
        }
    }
    patch_u32(&mut output, 0, output_layers);
    Ok(output)
}

#[no_mangle]
pub extern "C" fn raster_vectorize_alloc(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let mut buffer = vec![0u8; length as usize].into_boxed_slice();
    let pointer = buffer.as_mut_ptr() as u32;
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn raster_vectorize_free(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    let raw = std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
    drop(Box::from_raw(raw));
}

#[no_mangle]
pub unsafe extern "C" fn raster_vectorize_run(
    input_pointer: u32,
    width: u32,
    height: u32,
    mode: u32,
    maximum_colors: u32,
    threshold: u32,
    tolerance_milli_pixels: u32,
) -> u32 {
    LAST_RESULT_LENGTH.store(0, Ordering::SeqCst);
    LAST_ERROR.store(ERROR_NONE, Ordering::SeqCst);
    if input_pointer == 0 || width == 0 || height == 0 {
        set_error(ERROR_INPUT);
        return 0;
    }
    let input_length = (width as usize).checked_mul(height as usize).and_then(|pixels| pixels.checked_mul(4));
    let Some(input_length) = input_length else { set_error(ERROR_DIMENSIONS); return 0 };
    let input = std::slice::from_raw_parts(input_pointer as *const u8, input_length);
    match vectorize_rgba(input, width as usize, height as usize, mode, maximum_colors as usize, threshold.min(255) as u8, tolerance_milli_pixels) {
        Ok(bytes) => {
            let length = bytes.len() as u32;
            let mut boxed = bytes.into_boxed_slice();
            let pointer = boxed.as_mut_ptr() as u32;
            std::mem::forget(boxed);
            LAST_RESULT_LENGTH.store(length, Ordering::SeqCst);
            pointer
        }
        Err(error) => {
            set_error(error);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn raster_vectorize_result_length() -> u32 {
    LAST_RESULT_LENGTH.load(Ordering::SeqCst)
}

#[no_mangle]
pub extern "C" fn raster_vectorize_last_error() -> u32 {
    LAST_ERROR.load(Ordering::SeqCst)
}

#[no_mangle]
pub unsafe extern "C" fn raster_vectorize_free_result(pointer: u32, length: u32) {
    raster_vectorize_free(pointer, length);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_result(bytes: &[u8]) -> Vec<([u8; 4], Vec<Vec<(u16, u16)>>)> {
        let mut offset = 4usize;
        let layer_count = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let mut layers = Vec::new();
        for _ in 0..layer_count {
            let color = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
            offset += 4;
            let contour_count = u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()) as usize;
            offset += 2;
            let mut contours = Vec::new();
            for _ in 0..contour_count {
                let point_count = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
                offset += 4;
                let mut points = Vec::new();
                for _ in 0..point_count {
                    let x = u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap());
                    let y = u16::from_le_bytes(bytes[offset + 2..offset + 4].try_into().unwrap());
                    offset += 4;
                    points.push((x, y));
                }
                contours.push(points);
            }
            layers.push((color, contours));
        }
        assert_eq!(offset, bytes.len());
        layers
    }

    #[test]
    fn traces_a_solid_rectangle_as_one_closed_pixel_aligned_contour() {
        let mut pixels = vec![0u8; 4 * 4 * 4];
        for y in 1..3 {
            for x in 1..3 {
                let offset = (y * 4 + x) * 4;
                pixels[offset..offset + 4].copy_from_slice(&[240, 20, 10, 255]);
            }
        }
        let result = vectorize_rgba(&pixels, 4, 4, 0, 8, 128, 0).unwrap();
        let layers = decode_result(&result);
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].1.len(), 1);
        assert_eq!(layers[0].1[0].len(), 4);
        assert_eq!(layers[0].1[0].iter().copied().collect::<std::collections::HashSet<_>>().len(), 4);
    }

    #[test]
    fn preserves_transparent_holes_as_even_odd_contours() {
        let mut pixels = vec![0u8; 5 * 5 * 4];
        for y in 0..5 {
            for x in 0..5 {
                if x == 2 && y == 2 { continue; }
                let offset = (y * 5 + x) * 4;
                pixels[offset..offset + 4].copy_from_slice(&[30, 100, 220, 255]);
            }
        }
        let layers = decode_result(&vectorize_rgba(&pixels, 5, 5, 0, 4, 128, 0).unwrap());
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].1.len(), 2);
    }

    #[test]
    fn separates_diagonal_islands_without_joining_their_contours() {
        let mut pixels = vec![0u8; 2 * 2 * 4];
        pixels[..4].copy_from_slice(&[255, 0, 0, 255]);
        pixels[12..16].copy_from_slice(&[255, 0, 0, 255]);
        let layers = decode_result(&vectorize_rgba(&pixels, 2, 2, 0, 2, 128, 0).unwrap());
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].1.len(), 2);
    }

    #[test]
    fn supports_black_and_white_threshold_and_rejects_unbounded_dimensions() {
        let pixels = [0, 0, 0, 255, 200, 200, 200, 255];
        let result = vectorize_rgba(&pixels, 2, 1, 2, 2, 128, 0).unwrap();
        let layers = decode_result(&result);
        assert_eq!(layers.len(), 2);
        assert!(vectorize_rgba(&pixels, 2_000, 2_000, 2, 2, 128, 0).is_err());
    }
}
