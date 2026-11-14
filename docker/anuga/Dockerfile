# ANUGA hydrodynamic model (GPL, offline only — never shipped in the web app). Used by pipeline/05_anuga_scenarios.
FROM python:3.11-slim
ENV PIP_NO_CACHE_DIR=1 OMP_NUM_THREADS=8 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin libgdal-dev build-essential gfortran \
    && rm -rf /var/lib/apt/lists/*
RUN pip install "numpy<2.3" scipy matplotlib netCDF4 rasterio shapely pyproj "anuga>=3.1" pyyaml jupyter nbconvert
WORKDIR /work
CMD ["python", "-c", "import anuga; print('anuga', anuga.__version__)"]
