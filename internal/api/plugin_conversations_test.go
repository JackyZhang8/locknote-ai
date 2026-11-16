package api

import (
	"encoding/json"
	"testing"
)

func TestPluginConversationRoutes(t *testing.T) {
	s := pluginAPI(t)
	rec, err := s.cfg.Plugins.Install(pluginZIP(t))
	if err != nil {
		t.Fatal(err)
	}
	base := "/api/plugins/" + rec.Manifest.ID + "/conversations"
	if got := pluginRequest(s, "GET", base, "", ""); got.Code != 403 {
		t.Fatal(got.Code)
	}
	if got := pluginRequest(s, "GET", base, "", "desktop-secret"); got.Code != 403 {
		t.Fatal("disabled", got.Code)
	}
	s.cfg.Plugins.SetEnabled(rec.Manifest.ID, true)
	response := pluginRequest(s, "POST", base, "{\"title\":\"Hello\"}", "desktop-secret")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var c struct{ ID string }
	json.Unmarshal(response.Body.Bytes(), &c)
	response = pluginRequest(s, "POST", base+"/"+c.ID, "{\"expectedSeq\":1,\"events\":[{\"type\":\"message\",\"role\":\"user\",\"content\":\"Hi\"}]}", "desktop-secret")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	response = pluginRequest(s, "POST", base+"/"+c.ID, "{\"expectedSeq\":1,\"events\":[{\"type\":\"message\"}]}", "desktop-secret")
	if response.Code != 409 {
		t.Fatal(response.Code, response.Body.String())
	}
	response = pluginRequest(s, "GET", base+"/"+c.ID, "", "desktop-secret")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	response = pluginRequest(s, "DELETE", base+"/"+c.ID, "", "desktop-secret")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}
