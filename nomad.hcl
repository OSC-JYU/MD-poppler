# In disk mode (the default) the service reads and writes MessyDesk's data/ directly, so the job
# needs the host path of the MessyDesk root: nomad job run -var md_path=/path/to/MessyDesk nomad.hcl
variable "md_path" {
  type        = string
  description = "Host path of the MessyDesk root (the directory that contains data/)"
}

job "md-poppler" {
  type = "service"

  group "MD-image" {
    count = 1
    network {
      port "node" {
        to = 8300
      }
    }

    service {
      name     = "md-poppler"
      port     = "node"
      provider = "nomad"

      check {
        type     = "http"
        path     = "/health"
        interval = "10s"
        timeout  = "3s"
      }
    }

    task "md-poppler" {
      driver = "docker"
      config {
          image = "osc.repo.kopla.jyu.fi/messydesk/md-poppler:0.1"
          ports = ["node"]
          volumes = ["${var.md_path}/data:/app/data:Z"]
          auth {
            username = ""
            password = ""
          }
      }
      env {
        CONTAINER = "true"
        MD_PATH = "/app"
        # Overrides service.json's static local_url so /config reports the host-mapped address.
        SERVICE_LOCAL_URL = "http://${NOMAD_IP_node}:${NOMAD_HOST_PORT_node}"
      }
      resources {
        memory = 1000  # Memory in MB
        cpu    = 500  # CPU shares (500 = 50% of 1 CPU)
      }
    }
  }
}