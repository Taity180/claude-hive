use image::{RgbaImage, Rgba};
use tauri::image::Image as TauriImage;

/// Generate a tray icon with a red badge showing the count.
/// If count is 0, returns the base icon unchanged.
pub fn create_badged_icon(base_icon_bytes: &[u8], count: u32) -> Result<TauriImage<'static>, String> {
    let base = image::load_from_memory(base_icon_bytes)
        .map_err(|e| format!("Failed to load icon: {}", e))?
        .to_rgba8();

    if count == 0 {
        let width = base.width();
        let height = base.height();
        let pixels = base.into_raw();
        return Ok(TauriImage::new_owned(pixels, width, height));
    }

    let mut img = base;
    let w = img.width();

    // Badge size relative to icon
    let badge_radius = (w as f32 * 0.28) as u32;
    let badge_cx = w - badge_radius - 1;
    let badge_cy = badge_radius + 1;

    // Draw red circle
    draw_filled_circle(&mut img, badge_cx as i32, badge_cy as i32, badge_radius as i32, Rgba([220, 38, 38, 255]));

    // Draw white border
    draw_circle_outline(&mut img, badge_cx as i32, badge_cy as i32, badge_radius as i32, Rgba([255, 255, 255, 200]));

    // Draw the number (simple pixel font for 1-9, "9+" for larger)
    let text = if count <= 9 {
        count.to_string()
    } else {
        "9+".to_string()
    };
    draw_text_centered(&mut img, badge_cx as i32, badge_cy as i32, badge_radius as i32, &text);

    let width = img.width();
    let height = img.height();
    let pixels = img.into_raw();
    Ok(TauriImage::new_owned(pixels, width, height))
}

fn draw_filled_circle(img: &mut RgbaImage, cx: i32, cy: i32, radius: i32, color: Rgba<u8>) {
    for y in (cy - radius)..=(cy + radius) {
        for x in (cx - radius)..=(cx + radius) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                if x >= 0 && y >= 0 && (x as u32) < img.width() && (y as u32) < img.height() {
                    img.put_pixel(x as u32, y as u32, color);
                }
            }
        }
    }
}

fn draw_circle_outline(img: &mut RgbaImage, cx: i32, cy: i32, radius: i32, color: Rgba<u8>) {
    for y in (cy - radius - 1)..=(cy + radius + 1) {
        for x in (cx - radius - 1)..=(cx + radius + 1) {
            let dx = x - cx;
            let dy = y - cy;
            let dist_sq = dx * dx + dy * dy;
            let r_inner = (radius - 1) * (radius - 1);
            let r_outer = (radius + 1) * (radius + 1);
            if dist_sq >= r_inner && dist_sq <= r_outer {
                if x >= 0 && y >= 0 && (x as u32) < img.width() && (y as u32) < img.height() {
                    // Only draw on pixels that aren't already the badge color
                    let existing = img.get_pixel(x as u32, y as u32);
                    if existing[0] != 220 || existing[1] != 38 {
                        img.put_pixel(x as u32, y as u32, color);
                    }
                }
            }
        }
    }
}

fn draw_text_centered(img: &mut RgbaImage, cx: i32, cy: i32, radius: i32, text: &str) {
    let white = Rgba([255, 255, 255, 255]);
    let scale = (radius as f32 * 0.9) as i32;

    match text {
        "1" => {
            let x = cx;
            for dy in -scale..=scale {
                put_if_valid(img, x, cy + dy / 2, white);
            }
            put_if_valid(img, x - 1, cy - scale / 2 + 1, white);
        }
        "2" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            put_if_valid(img, cx + s, cy - s + 1, white);
            put_if_valid(img, cx + s, cy - 1, white);
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            put_if_valid(img, cx - s, cy + 1, white);
            put_if_valid(img, cx - s, cy + s - 1, white);
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        "3" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            for dy in (-s + 1)..0 { put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            for dy in 1..s { put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        "4" => {
            let s = scale / 2;
            for dy in -s..=0 { put_if_valid(img, cx - s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            for dy in -s..=s { put_if_valid(img, cx + s, cy + dy, white); }
        }
        "5" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            put_if_valid(img, cx - s, cy - s + 1, white);
            put_if_valid(img, cx - s, cy - 1, white);
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            put_if_valid(img, cx + s, cy + 1, white);
            put_if_valid(img, cx + s, cy + s - 1, white);
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        "6" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            for dy in (-s + 1)..s { put_if_valid(img, cx - s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            for dy in 1..s { put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        "7" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            for dy in -s..=s { put_if_valid(img, cx + s, cy + dy, white); }
        }
        "8" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            for dy in (-s + 1)..0 { put_if_valid(img, cx - s, cy + dy, white); put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            for dy in 1..s { put_if_valid(img, cx - s, cy + dy, white); put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        "9" => {
            let s = scale / 2;
            for dx in -s..=s { put_if_valid(img, cx + dx, cy - s, white); }
            for dy in (-s + 1)..0 { put_if_valid(img, cx - s, cy + dy, white); put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy, white); }
            for dy in 1..=s { put_if_valid(img, cx + s, cy + dy, white); }
            for dx in -s..=s { put_if_valid(img, cx + dx, cy + s, white); }
        }
        _ => {
            // "9+" - draw a dot
            let s = scale / 3;
            draw_filled_circle(img, cx, cy, s, white);
        }
    }
}

fn put_if_valid(img: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>) {
    if x >= 0 && y >= 0 && (x as u32) < img.width() && (y as u32) < img.height() {
        img.put_pixel(x as u32, y as u32, color);
    }
}
