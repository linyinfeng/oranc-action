{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  name = "oranc-test";
  dontUnpack = true;
  installPhase = ''
    cp -r ${../.} $out
  '';
}
