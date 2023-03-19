# oranc-action

[oranc](https://github.com/linyinfeng/oranc) as GitHub action! Use an OCI registry (typically, [ghcr.io](https://ghcr.io)) to cache your build.

## Quick Start

After the first run, the `ghcr.io/{OWNER}/oranc-cache` package will be created (under default configuration). You need to make the package public otherwise caching will not work. The cache will also be publicly accessible through `https://oranc.li7g.com/ghcr.io/{OWNER}/oranc-cache`.

```yaml
check:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    # need write permission to write to ghcr registry
    packages: write
  # setup an oranc service container
  # default configuration use https://cache.nixos.org as upstream
  services:
    oranc:
      image: ghcr.io/linyinfeng/oranc
  steps:
    - uses: actions/checkout@v3
    - name: Install nix
      uses: cachix/install-nix-action@v20
    - uses: linyinfeng/oranc-action@v1
      with:
        # pass oranc container id to the action
        orancContainer: '${{ job.services.oranc.id }}'
        # use `nix key generate-secret` to generate a signing key
        # keep it safe!
        signingKey: ${{ secrets.NIX_SINGING_KEY }}
    # build anything with cache
    - run: |
        nix build
```

## Configuration

See [action.yml](./action.yml) for all configurations.
