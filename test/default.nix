{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "oranc-action-test";
  # increase version to force rebuild the package
  version = "1";
  dontUnpack = true;
  installPhase = ''
    echo $version > $out
  '';
}
