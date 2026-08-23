use serde::{Deserialize, Serialize};

/// A monitor's area in physical pixels. Deliberately a plain struct rather
/// than a `tauri::Monitor` so the geometry can be tested without a running
/// window; conversion happens at the Tauri boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Anchor {
    /// True for the two anchors where the rail lies along a horizontal edge
    /// and is therefore wide rather than tall.
    pub fn is_horizontal(&self) -> bool {
        matches!(self, Anchor::Top | Anchor::Bottom)
    }

    /// Parse the short ids the settings UI sends.
    pub fn from_str_id(id: &str) -> Option<Anchor> {
        Some(match id {
            "left" => Anchor::Left,
            "right" => Anchor::Right,
            "top" => Anchor::Top,
            "bottom" => Anchor::Bottom,
            "tl" => Anchor::TopLeft,
            "tr" => Anchor::TopRight,
            "bl" => Anchor::BottomLeft,
            "br" => Anchor::BottomRight,
            _ => return None,
        })
    }
}

/// Top-left physical position for a rail of `size` on `monitor`, held `offset`
/// pixels clear of the edges it touches. Centred axes are clamped at the
/// monitor origin so an oversized rail never lands off-screen.
pub fn anchored_position(
    monitor: MonitorRect,
    anchor: Anchor,
    size: (u32, u32),
    offset: i32,
) -> (i32, i32) {
    let (w, h) = (size.0 as i32, size.1 as i32);
    let (mw, mh) = (monitor.width as i32, monitor.height as i32);

    let centre = |span: i32, extent: i32| ((span - extent) / 2).max(0);
    let far = |origin: i32, span: i32, extent: i32| origin + span - extent - offset;

    match anchor {
        Anchor::Left => (monitor.x + offset, monitor.y + centre(mh, h)),
        Anchor::Right => (far(monitor.x, mw, w), monitor.y + centre(mh, h)),
        Anchor::Top => (monitor.x + centre(mw, w), monitor.y + offset),
        Anchor::Bottom => (monitor.x + centre(mw, w), far(monitor.y, mh, h)),
        Anchor::TopLeft => (monitor.x + offset, monitor.y + offset),
        Anchor::TopRight => (far(monitor.x, mw, w), monitor.y + offset),
        Anchor::BottomLeft => (monitor.x + offset, far(monitor.y, mh, h)),
        Anchor::BottomRight => (far(monitor.x, mw, w), far(monitor.y, mh, h)),
    }
}

/// Index of the monitor whose rect contains `cursor`. Half-open on the far
/// edges, so a cursor exactly on a shared boundary belongs to exactly one
/// monitor rather than matching both.
pub fn monitor_containing(monitors: &[MonitorRect], cursor: (i32, i32)) -> Option<usize> {
    let (cx, cy) = cursor;
    monitors.iter().position(|m| {
        cx >= m.x && cx < m.x + m.width as i32 && cy >= m.y && cy < m.y + m.height as i32
    })
}

/// Is `point` inside the rect at `origin` of `size`?
///
/// Half-open on the far edges, like `monitor_containing`: a cursor exactly on
/// the boundary belongs to one rect, not two.
pub fn rect_contains(origin: (i32, i32), size: (u32, u32), point: (i32, i32)) -> bool {
    let (x, y) = origin;
    let (w, h) = size;
    let (px, py) = point;
    px >= x && px < x + w as i32 && py >= y && py < y + h as i32
}

/// Which monitor the rail belongs on.
///
/// A pin wins outright: the user asked for that screen, so a cursor on another
/// one is not a reason to move. An out-of-range pin is ignored rather than an
/// error — monitors get unplugged, and a rail that refuses to place itself is
/// worse than one on the wrong screen.
pub fn target_index(
    monitors: &[MonitorRect],
    pinned: Option<usize>,
    cursor: Option<(i32, i32)>,
) -> usize {
    if let Some(index) = pinned {
        if index < monitors.len() {
            return index;
        }
    }
    cursor
        .and_then(|c| monitor_containing(monitors, c))
        .unwrap_or_else(|| primary_index(monitors))
}

/// Index of the primary monitor. Windows always places the primary display at
/// the desktop origin, and every other monitor is offset from it — which is why
/// a multi-monitor setup reports negative coordinates for screens to the left.
/// Falls back to the first monitor if nothing sits at the origin.
pub fn primary_index(monitors: &[MonitorRect]) -> usize {
    monitors
        .iter()
        .position(|m| m.x == 0 && m.y == 0)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon() -> MonitorRect {
        MonitorRect { x: 0, y: 0, width: 2560, height: 1440 }
    }

    #[test]
    fn right_centre_hugs_the_right_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Right, (32, 400), 8);
        assert_eq!(x, 2560 - 32 - 8);
        assert_eq!(y, (1440 - 400) / 2);
    }

    #[test]
    fn left_centre_hugs_the_left_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Left, (32, 400), 8);
        assert_eq!(x, 8);
        assert_eq!(y, (1440 - 400) / 2);
    }

    #[test]
    fn bottom_centre_hugs_the_bottom_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Bottom, (400, 32), 8);
        assert_eq!(x, (2560 - 400) / 2);
        assert_eq!(y, 1440 - 32 - 8);
    }

    #[test]
    fn corners_offset_on_both_axes() {
        let (x, y) = anchored_position(mon(), Anchor::BottomRight, (32, 400), 8);
        assert_eq!(x, 2560 - 32 - 8);
        assert_eq!(y, 1440 - 400 - 8);
    }

    #[test]
    fn a_monitor_at_a_negative_origin_still_resolves() {
        // A second screen placed to the left of the primary reports a
        // negative x. The rail must land on that screen, not on the primary.
        let left_of_primary = MonitorRect { x: -1920, y: 0, width: 1920, height: 1080 };
        let (x, y) = anchored_position(left_of_primary, Anchor::Right, (32, 400), 8);
        assert_eq!(x, -1920 + 1920 - 32 - 8);
        assert_eq!(y, (1080 - 400) / 2);
    }

    #[test]
    fn a_rail_taller_than_the_screen_is_clamped_not_negative() {
        let (_, y) = anchored_position(mon(), Anchor::Right, (32, 2000), 8);
        assert_eq!(y, 0, "must not position above the top of the monitor");
    }

    #[test]
    fn horizontal_anchors_are_reported_as_such() {
        assert!(Anchor::Top.is_horizontal());
        assert!(Anchor::Bottom.is_horizontal());
        assert!(!Anchor::Left.is_horizontal());
        assert!(!Anchor::TopRight.is_horizontal());
    }

    #[test]
    fn anchor_ids_round_trip_from_the_frontend() {
        assert_eq!(Anchor::from_str_id("br"), Some(Anchor::BottomRight));
        assert_eq!(Anchor::from_str_id("left"), Some(Anchor::Left));
        assert_eq!(Anchor::from_str_id("elsewhere"), None);
    }

    fn two_screens() -> Vec<MonitorRect> {
        vec![
            MonitorRect { x: 0, y: 0, width: 2560, height: 1440 },
            MonitorRect { x: 2560, y: 0, width: 1920, height: 1080 },
        ]
    }

    #[test]
    fn finds_the_monitor_under_the_cursor() {
        assert_eq!(monitor_containing(&two_screens(), (100, 100)), Some(0));
        assert_eq!(monitor_containing(&two_screens(), (3000, 500)), Some(1));
    }

    #[test]
    fn the_left_edge_belongs_to_the_monitor_it_starts() {
        // Exactly on the boundary must resolve to the second screen, not both.
        assert_eq!(monitor_containing(&two_screens(), (2560, 10)), Some(1));
        assert_eq!(monitor_containing(&two_screens(), (2559, 10)), Some(0));
    }

    #[test]
    fn a_cursor_in_the_dead_space_below_a_shorter_screen_finds_nothing() {
        // Screen 2 is only 1080 tall, so y=1200 at x=3000 is off every screen.
        assert_eq!(monitor_containing(&two_screens(), (3000, 1200)), None);
    }

    #[test]
    fn no_monitors_is_not_a_panic() {
        assert_eq!(monitor_containing(&[], (0, 0)), None);
    }

    /// The real layout on the development machine: a 1440p primary at the
    /// origin with three 1080p screens around it, two of them at negative x and
    /// all three at a different y origin. Enumeration order is not sorted.
    fn four_screens() -> Vec<MonitorRect> {
        vec![
            MonitorRect { x: 0, y: 0, width: 2560, height: 1440 },
            MonitorRect { x: -3840, y: 149, width: 1920, height: 1080 },
            MonitorRect { x: 2560, y: 154, width: 1920, height: 1080 },
            MonitorRect { x: -1920, y: 141, width: 1920, height: 1080 },
        ]
    }

    #[test]
    fn resolves_the_cursor_across_a_four_monitor_desktop() {
        let m = four_screens();
        assert_eq!(monitor_containing(&m, (1280, 700)), Some(0));
        assert_eq!(monitor_containing(&m, (-3000, 500)), Some(1));
        assert_eq!(monitor_containing(&m, (3500, 800)), Some(2));
        assert_eq!(monitor_containing(&m, (-1000, 600)), Some(3));
    }

    #[test]
    fn a_cursor_above_an_offset_screen_is_off_every_monitor() {
        // The left-hand screens start at y=141 and y=149, so y=50 out there is
        // in dead space above them — the case that has to fall back rather than
        // silently pick monitor 0.
        assert_eq!(monitor_containing(&four_screens(), (-1000, 50)), None);
    }

    #[test]
    fn the_primary_is_the_screen_at_the_origin_not_the_first_enumerated() {
        assert_eq!(primary_index(&four_screens()), 0);

        let primary_listed_last = vec![
            MonitorRect { x: -1920, y: 141, width: 1920, height: 1080 },
            MonitorRect { x: 0, y: 0, width: 2560, height: 1440 },
        ];
        assert_eq!(primary_index(&primary_listed_last), 1);
    }

    #[test]
    fn primary_index_falls_back_when_nothing_sits_at_the_origin() {
        let odd = vec![MonitorRect { x: -1920, y: 141, width: 1920, height: 1080 }];
        assert_eq!(primary_index(&odd), 0);
        assert_eq!(primary_index(&[]), 0);
    }

    #[test]
    fn anchors_to_the_right_edge_of_a_far_left_screen() {
        // Placing on DISPLAY5 must land near x = -1920, not near the primary.
        let m = four_screens();
        let (x, y) = anchored_position(m[1], Anchor::Right, (32, 140), 8);
        assert_eq!(x, -3840 + 1920 - 32 - 8);
        assert_eq!(y, 149 + (1080 - 140) / 2);
    }

    #[test]
    fn a_pin_beats_the_cursor() {
        let monitors = four_screens();
        // Cursor on the primary, pinned to the far-left screen.
        assert_eq!(target_index(&monitors, Some(0), Some((100, 100))), 0);
        assert_eq!(target_index(&monitors, Some(3), Some((100, 100))), 3);
    }

    #[test]
    fn an_out_of_range_pin_falls_back_to_the_cursor() {
        // A monitor can be unplugged between the pin being saved and used.
        let monitors = four_screens();
        let on_primary = target_index(&monitors, None, Some((100, 100)));
        assert_eq!(target_index(&monitors, Some(99), Some((100, 100))), on_primary);
    }

    #[test]
    fn with_no_pin_and_no_cursor_it_uses_primary() {
        let monitors = four_screens();
        assert_eq!(
            target_index(&monitors, None, None),
            primary_index(&monitors)
        );
    }

    #[test]
    fn with_no_pin_it_follows_the_cursor() {
        let monitors = four_screens();
        let cursor = (monitors[1].x + 10, monitors[1].y + 10);
        assert_eq!(target_index(&monitors, None, Some(cursor)), 1);
    }

    #[test]
    fn rect_contains_is_half_open_on_the_far_edges() {
        let origin = (2528, 650);
        let size = (32u32, 140u32);

        assert!(rect_contains(origin, size, (2528, 650)), "the top-left corner is inside");
        assert!(rect_contains(origin, size, (2540, 700)));
        assert!(!rect_contains(origin, size, (2560, 700)), "the far edge is outside");
        assert!(!rect_contains(origin, size, (2540, 790)));
        assert!(!rect_contains(origin, size, (2527, 700)), "one pixel short is outside");
    }

    #[test]
    fn rect_contains_handles_a_negative_origin() {
        // Monitors left of the primary report negative coordinates.
        assert!(rect_contains((-1920, 141), (32, 140), (-1900, 200)));
        assert!(!rect_contains((-1920, 141), (32, 140), (-1930, 200)));
    }
}
