{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = with pkgs; [
    nodePackages.pnpm
    nodejs
  ];
}
