package password

import "testing"

func TestHashVerifyRoundtrip(t *testing.T) {
	hash, err := Hash("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	ok, upgrade := Verify("correct horse battery staple", hash)
	if !ok {
		t.Fatal("valid password rejected")
	}
	if upgrade {
		t.Fatal("argon2id hash should not require upgrade")
	}
	ok, _ = Verify("wrong password", hash)
	if ok {
		t.Fatal("invalid password accepted")
	}
}

func TestVerifyLegacyBcrypt(t *testing.T) {
	// $2a$10$... generated for "s3cret"
	hash := "$2a$10$fsOMMH4DrjK.SgC.21C9yeyPFOnxONvNlt4muQGYzAoO1135Zxk9q"
	ok, upgrade := Verify("s3cret", hash)
	if !ok || !upgrade {
		t.Fatalf("bcrypt: ok=%v upgrade=%v, want true/true", ok, upgrade)
	}
}

func TestVerifyGarbage(t *testing.T) {
	for _, bad := range []string{"", "plaintext", "$argon2id$v=19$m=1$salt$hash", "$5$rounds=1$xx$yy"} {
		if ok, _ := Verify("pw", bad); ok {
			t.Fatalf("garbage hash %q accepted", bad)
		}
	}
}
