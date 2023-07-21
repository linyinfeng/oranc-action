# oranc-action

[oranc](https://github.com/linyinfeng/oranc) as GitHub action.

Use an OCI registry (typically, [ghcr.io](https://ghcr.io)) to distribute binary caches of your Nix packages.

## Warning

Tags, image manifests, and layers created by oranc are so different from other typical OCI repositories.
So I don't know if it is an abuse of OCI registries. Pushing to [ghcr.io](https://ghcr.io) may violate the terms of service of GitHub.

## Quick Start

Install [oranc](https://github.com/linyinfeng/oranc). Run `oranc push --repository "{OWNER}/oranc-cache" initialize`, the `ghcr.io/{OWNER}/oranc-cache` package will be created. You need to make the package public otherwise caching will not work.

The cache can be shared with multiple repositories, you need to add `write` permission for these repositories in "https://github.com/users/{OWNER}/packages/container/oranc-cache/settings".

Then, write your workflow jobs using this action and the `ghcr.io/linyinfeng/oranc` container.

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

The cache will also be publicly accessible through `https://oranc.li7g.com/ghcr.io/{OWNER}/oranc-cache`. Use the cache by setting `nix.conf` like this.

```text
substituters = https://oranc.li7g.com/ghcr.io/{OWNER}/oranc-cache
trusted-public-keys = {YOUR_PUBLIC_KEY}
```

`oranc.li7g.com` might be slow because of limited machine resources, you can easily self-host an instance according to the README of [oranc](https://github.com/linyinfeng/oranc).

## Configuration

See [action.yml](./action.yml) for all configurations.
