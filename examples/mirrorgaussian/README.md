# MirrorGaussian

This example composites a real-scene splat pass with one reflected splat and
mask pass per mirror. It expects SPZ files beside a `mirrorgaussian-spark-v2`
manifest:

```text
assets/
  mirror.json
  real.spz
  mirrors/
    <mirror-id>/
      mask.spz
      mirror.spz
```

The manifest's asset paths may use `.ply`; the example substitutes `.spz` when
loading them. Each mirror entry must provide `sh_view_basis_row_major`, a 3x3
object-space basis used to evaluate the reflected scene's spherical harmonics.

```json
{
  "schema": "mirrorgaussian-spark-v2",
  "assets": { "real": "real.ply" },
  "mirrors": [
    {
      "id": "1",
      "assets": {
        "mask": "mirrors/1/mask.ply",
        "mirror": "mirrors/1/mirror.ply"
      },
      "sh_view_basis_row_major": [-1, 0, 0, 0, 1, 0, 0, 0, 1]
    }
  ]
}
```

The passes use one camera snapshot and finish sorting before their render
targets are composited. LOD is disabled because independently updated LOD trees
can make the real, reflected, and mask passes use different camera states.

Run `npm start`, then open
`http://localhost:8080/examples/mirrorgaussian/`.
