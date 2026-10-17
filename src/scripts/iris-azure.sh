#!/usr/bin/env bash
# Společný nemocniční FHIR server pro tým: InterSystems IRIS for Health (komunitní image) v Azure Container Instances.
# Spouští se v Azure Cloud Shellu (Bash): celý soubor vložit a Enter. Kontejner si při startu sám
# nastaví silné heslo (místo SYS) a založí FHIR server /fhir/r4. Data se pak nahrají z počítače:
#   node --env-file=.env scripts/seed-fhir.mjs --nahrat <hackathon kit>/docker-iris-fhir/data/fhir
#
# Bez disku: po restartu kontejneru jsou data pryč (heslo zůstává), stačí znovu seed-fhir.
# Smazání: az container delete -g <resource group> -n team71-iris --yes
set -euo pipefail

RG="${RG:-$(az group list --query '[0].name' -o tsv)}"
NAME=team71-iris
LABEL="team71-iris-$(az account show --query id -o tsv | cut -c1-6)"
PW="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)"
echo "Resource group: $RG"

# Spustí se uvnitř kontejneru, až IRIS naběhne (iris-main --after). ObjectScript bez znaku dolar.
cat > /tmp/iris-setup.sh <<EOF
iris session IRIS -U %SYS <<'OBJECTSCRIPT'
do ##class(Security.Users).UnExpireUserPasswords("*")
set p("Password")="$PW"
for u="SuperUser","_SYSTEM","Admin" { do ##class(Security.Users).Modify(u,.p) }
set q("Enabled")=0
do ##class(Security.Users).Modify("UnknownUser",.q)
zn "HSLIB"
do ##class(HS.Util.Installer.Foundation).Install("FHIRSERVER")
zn "FHIRSERVER"
do ##class(HS.FHIRServer.Installer).InstallNamespace()
do ##class(HS.FHIRServer.Installer).InstallInstance("/fhir/r4","HS.FHIRServer.Storage.JsonAdvSQL.InteractionsStrategy","hl7.fhir.r4.core@4.0.1")
halt
OBJECTSCRIPT
EOF

az container create -g "$RG" -n "$NAME" \
  --image intersystems/irishealth-community:latest-cd --os-type Linux \
  --cpu 1 --memory 3 --ports 52773 --protocol TCP \
  --ip-address Public --dns-name-label "$LABEL" \
  --secrets iris-setup.sh="$(cat /tmp/iris-setup.sh)" --secrets-mount-path /setup \
  --command-line "/tini -- /iris-main --after 'bash /setup/iris-setup.sh'" \
  --restart-policy Always -o none
rm /tmp/iris-setup.sh

URL="http://$(az container show -g "$RG" -n "$NAME" --query ipAddress.fqdn -o tsv):52773/fhir/r4"
echo "Čekám, až IRIS založí FHIR server (pár minut)…"
for i in $(seq 1 90); do
  if curl -sf -u "SuperUser:$PW" "$URL/metadata" -o /dev/null; then break; fi
  sleep 10
done
curl -sf -u "SuperUser:$PW" "$URL/metadata" -o /dev/null && echo "FHIR server běží." || echo "Zatím neodpovídá, logy: az container logs -g $RG -n $NAME"

echo
echo "Do nextjs/.env (heslo nikam do gitu ani do chatu):"
echo "FHIR_BASE_URL=$URL"
echo "FHIR_USER=SuperUser"
echo "FHIR_PASSWORD=$PW"
