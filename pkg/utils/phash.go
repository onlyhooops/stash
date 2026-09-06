package utils

import (
	"math"
	"strconv"

	"github.com/corona10/goimagehash"
	"github.com/stashapp/stash/pkg/sliceutil"
)

// Phash represents a single phash entry for an item (scene or image) to be
// used when finding duplicates. ItemID is the id of the item (scene or image)
// that the phash belongs to. Where items may have multiple files, one Phash
// entry is expected per item/file with a phash.
type Phash struct {
	ItemID    int     `db:"id"`
	Hash      int64   `db:"phash"`
	Duration  float64 `db:"duration"`
	Neighbors []int
	Bucket    int
}

// FindDuplicates returns the ids of items (scenes or images) that have
// perceptual duplicate hashes, grouped into duplicate sets. Items are only
// considered to be duplicates where their phash distance is within the
// provided distance. If durationDiff is negative, then the duration of the
// items is not considered. Items with a duration of 0 or less are not
// considered for duration matching. Entry durations may be negative (eg -1)
// to indicate that the duration is unknown.
func FindDuplicates(hashes []*Phash, distance int, durationDiff float64) [][]int {
	for i, item := range hashes {
		itemHash := goimagehash.NewImageHash(uint64(item.Hash), goimagehash.PHash)
		for j, neighbor := range hashes {
			if i != j && item.ItemID != neighbor.ItemID {
				neighbourDurationDistance := 0.
				if item.Duration > 0 && neighbor.Duration > 0 {
					neighbourDurationDistance = math.Abs(item.Duration - neighbor.Duration)
				}
				if (neighbourDurationDistance <= durationDiff) || (durationDiff < 0) {
					neighborHash := goimagehash.NewImageHash(uint64(neighbor.Hash), goimagehash.PHash)
					neighborDistance, _ := itemHash.Distance(neighborHash)
					if neighborDistance <= distance {
						item.Neighbors = append(item.Neighbors, j)
					}
				}
			}
		}
	}

	var buckets [][]int
	for _, item := range hashes {
		if len(item.Neighbors) > 0 && item.Bucket == -1 {
			bucket := len(buckets)
			items := []int{item.ItemID}
			item.Bucket = bucket
			findNeighbors(bucket, item.Neighbors, hashes, &items)

			if len(items) > 1 {
				buckets = append(buckets, items)
			}
		}
	}

	return buckets
}

func findNeighbors(bucket int, neighbors []int, hashes []*Phash, items *[]int) {
	for _, id := range neighbors {
		hash := hashes[id]
		if hash.Bucket == -1 {
			hash.Bucket = bucket
			*items = sliceutil.AppendUnique(*items, hash.ItemID)
			findNeighbors(bucket, hash.Neighbors, hashes, items)
		}
	}
}

func PhashToString(phash int64) string {
	return strconv.FormatUint(uint64(phash), 16)
}

func StringToPhash(s string) (int64, error) {
	ret, err := strconv.ParseUint(s, 16, 64)
	if err != nil {
		return 0, err
	}

	return int64(ret), nil
}
