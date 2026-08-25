# VulcanoCraft Resource Pack

Centrale opslag voor de VulcanoCraft resource pack(s) met automatische SHA-1 generatie en vaste download-URLs.

## Hoe werkt het?

Er is **één vaste release-tag**: `1.0`

Deze tag bevat altijd de actuele versie van de resource pack(s).  
De download-URL verandert **nooit**.

### Vaste URLs
https://github.com/VulcanoSoftware/vulcanocraft_resourcepack/releases/download/1.0/VulcanoPackEnhancedExplosions.zip
https://github.com/VulcanoSoftware/vulcanocraft_resourcepack/releases/download/1.0/VulcanoPackEnhancedExplosions.zip.sha1


### Automatische flow

1. Jij maakt een **nieuwe release** (met eender welke tijdelijke tag).
2. Je uploadt daarin de nieuwe `.zip` file(s).
3. GitHub Actions doet daarna automatisch het volgende:
   - Berekent de SHA-1 van de zip
   - Maakt een `.sha1` bestandje
   - Kijkt of de bestandsnaam al bestaat in tag `1.0` (niet hoofdlettergevoelig)
   - **Als de naam overeenkomt** → oude bestanden worden verwijderd en vervangen (met de originele casing)
   - **Als de naam nieuw is** → het bestand wordt gewoon toegevoegd aan tag `1.0`
   - De tijdelijke release wordt daarna volledig verwijderd

Resultaat: tag `1.0` is altijd up-to-date en bevat de juiste `.zip` + `.sha1` bestanden.

---

## Hoe gebruik je het?

### Nieuwe / bijgewerkte resource pack uploaden

1. Ga naar het tabblad **Releases**
2. Klik op **Draft a new release**
3. Kies een **tijdelijke tag** (bijvoorbeeld `update`, `temp`, `2026-08-25`, …)  
   ⚠️ Gebruik **niet** de tag `1.0`
4. Upload je `.zip` bestand(en)
5. Klik op **Publish release**

GitHub Actions regelt de rest automatisch.  
Na een minuut of 2 staat alles correct in tag `1.0` en is de tijdelijke release verwijderd.

### Belangrijke regels

| Situatie | Wat er gebeurt |
|---------|----------------|
| Je uploadt `VulcanoPackEnhancedExplosions.zip` | Wordt bijgewerkt in tag `1.0` |
| Je uploadt `vulcanopackenhancedexplosions.zip` | Wordt ook herkend als update (niet hoofdlettergevoelig) en hernoemd naar de originele casing |
| Je uploadt een zip met een **nieuwe** naam | Wordt toegevoegd aan tag `1.0` |
| Je publiceert per ongeluk op tag `1.0` | De Action doet niets (veiligheid) |

---

## Voor developers / server owners

### SHA-1 bestand

Bij elke zip hoort een `.sha1` bestand met precies dezelfde naam + `.sha1`.  
Voorbeeld:
VulcanoPackEnhancedExplosions.zip
VulcanoPackEnhancedExplosions.zip.sha1


Inhoud van het `.sha1` bestand = alleen de 40-tekens SHA-1 hash (geen extra tekst).

Dit maakt het mogelijk om de hash dynamisch op te halen zonder de hele pack te downloaden.

### Aanbevolen command (voor plugins)
/assignpack %player% https://github.com/VulcanoSoftware/vulcanocraft_resourcepack/releases/download/1.0/VulcanoPackEnhancedExplosions.zip auto

Of met meerdere mirrors:

/assignpack %player%   auto


---

## Technische details

- Workflow: `.github/workflows/update-resourcepack.yml`
- Trigger: bij het publiceren van een nieuwe release (behalve tag `1.0`)
- Tooling: GitHub CLI (`gh`) + `sha1sum`
- Case-insensitive matching + behoud van originele bestandsnaam-casing

---

## Licentie

[Voeg hier je licentie toe indien gewenst]
