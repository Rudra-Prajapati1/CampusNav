export function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = j;
      }
    }
    if (Math.abs(augmented[maxRow][i]) < 1e-12) return null;
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    const pivot = augmented[i][i];
    for (let col = i; col <= n; col += 1) augmented[i][col] /= pivot;
    for (let row = 0; row < n; row += 1) {
      if (row === i) continue;
      const factor = augmented[row][i];
      for (let col = i; col <= n; col += 1) {
        augmented[row][col] -= factor * augmented[i][col];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

export function homographyFromCorners(pixelCorners, geoCorners) {
  if (pixelCorners.length !== 4 || geoCorners.length !== 4) return null;
  const matrix = [];
  const vector = [];

  for (let i = 0; i < 4; i += 1) {
    const [x, y] = pixelCorners[i];
    const [lng, lat] = geoCorners[i];

    matrix.push([x, y, 1, 0, 0, 0, -x * lng, -y * lng]);
    vector.push(lng);

    matrix.push([0, 0, 0, x, y, 1, -x * lat, -y * lat]);
    vector.push(lat);
  }

  const solved = solveLinearSystem(matrix, vector);
  if (!solved) return null;
  return [
    [solved[0], solved[1], solved[2]],
    [solved[3], solved[4], solved[5]],
    [solved[6], solved[7], 1],
  ];
}

export function applyHomography(matrix, x, y) {
  if (!matrix) return null;
  const denom = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (Math.abs(denom) < 1e-10) return null;
  const lng = (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denom;
  const lat = (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denom;
  return [lng, lat];
}
