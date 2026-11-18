//! Discrete pointy-top axial geometry (SPEC §5.1).

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Hex {
    pub q: i32,
    pub r: i32,
}

impl Hex {
    /// Directions in the stable order defined by SPEC §5.1, starting at (+1, 0).
    /// Slots beyond the representable i32 plane are None, preserving direction indices.
    pub fn neighbors(self) -> [Option<Self>; 6] {
        [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)].map(|(dq, dr)| {
            Some(Self {
                q: self.q.checked_add(dq)?,
                r: self.r.checked_add(dr)?,
            })
        })
    }

    pub fn distance(self, other: Self) -> u64 {
        let dq = i64::from(self.q) - i64::from(other.q);
        let dr = i64::from(self.r) - i64::from(other.r);
        (dq.unsigned_abs() + dr.unsigned_abs() + (dq + dr).unsigned_abs()) / 2
    }
}

#[cfg(test)]
mod tests {
    use super::Hex;
    use std::collections::HashSet;

    #[test]
    fn neighbors_are_ordered_distinct_and_adjacent() {
        let center = Hex { q: -3, r: 1 };
        let neighbors = center.neighbors();
        let expected = [(-2, 1), (-2, 0), (-3, 0), (-4, 1), (-4, 2), (-3, 2)];
        assert_eq!(neighbors, expected.map(|(q, r)| Some(Hex { q, r })));
        assert_eq!(
            neighbors
                .into_iter()
                .flatten()
                .collect::<HashSet<_>>()
                .len(),
            6
        );
        for neighbor in neighbors.into_iter().flatten() {
            assert_eq!(center.distance(neighbor), 1);
        }
    }

    #[test]
    fn distance_is_symmetric_and_exact_over_the_full_domain() {
        for ((q, r), (s, t), expected) in [
            ((-3, 2), (-3, 2), 0),
            ((0, 0), (2, -1), 2),
            ((-4, -2), (1, 3), 10),
            ((i32::MIN, i32::MIN), (i32::MAX, i32::MAX), 8_589_934_590),
            ((i32::MIN, i32::MAX), (i32::MAX, i32::MIN), 4_294_967_295),
        ] {
            let a = Hex { q, r };
            let b = Hex { q: s, r: t };
            assert_eq!(a.distance(b), expected);
            assert_eq!(b.distance(a), expected);
        }
    }

    #[test]
    fn neighbors_do_not_wrap_at_integer_limits() {
        let corner = Hex {
            q: i32::MAX,
            r: i32::MIN,
        };
        assert_eq!(
            corner.neighbors().map(|n| n.is_some()),
            [false, false, false, true, true, true]
        );
        let opposite = Hex {
            q: i32::MIN,
            r: i32::MAX,
        };
        assert_eq!(
            opposite.neighbors().map(|n| n.is_some()),
            [true, true, true, false, false, false]
        );
    }
}
